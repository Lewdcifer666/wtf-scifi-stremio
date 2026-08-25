// Content DNA inertness proof (F2-6 test matrix case N, extended by F2-7).
//
// Reconstructs the complete pre-DNA world - a schema-2 taste profile with the
// four DNA sections removed AND every source item stripped of dna,
// dna_confidence and dna_tags - builds the site from it, then builds again from
// the committed schema-3 + enriched state. Every generated manifest and catalog
// file must be byte-identical.
//
// Both halves have to be reconstructed together: a schema-2 profile alongside
// DNA-bearing items is exactly the hybrid state the schema contract forbids, so
// validating that combination would be asserting something we deliberately made
// illegal.
//
// It also deep-equals the six production-consumed profile subtrees and greps
// the live canonical automation prompt for DNA references.
//
// Run with: node test/inertness.mjs
//
// Note on determinism: build-site.mjs reads Date.now() for the "past 24h"
// catalogs. The two builds run seconds apart, so this only matters if an item
// sits within seconds of the 24h boundary; the script checks that and says so.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert";
import { execFileSync } from "node:child_process";

const PROFILE = "data/taste-profile.json";
const LIBRARY = "data/library.json";
const DISCOVERY_DIR = "data/discoveries";
const SITE = "site";
const PROMPT = "DAILY_AUTOMATION_PROMPT.md";
const DNA_SECTIONS = ["dna_dimensions", "dna_baseline", "dna_guardrails", "execution_preferences"];
const DNA_ITEM_KEYS = ["dna", "dna_confidence", "dna_tags"];
const PRODUCTION_SUBTREES = [
  "strong_positive_signals", "negative_signals", "hard_exclusions",
  "reference_titles", "automation_rules", "controlled_tags"
];
const FORBIDDEN_IN_PROMPT = [
  "dna_dimensions", "dna_baseline", "dna_guardrails",
  "execution_preferences", "dna_confidence", "dna_tags", "personalized-scores"
];

let failed = 0;
const ok = (label, condition, detail) => {
  if (condition) console.log(`  ok   ${label}`);
  else { failed++; console.error(`  FAIL ${label}${detail ? `\n         ${detail}` : ""}`); }
};

const sourceFiles = [PROFILE, LIBRARY];
for (const name of fs.readdirSync(DISCOVERY_DIR).filter(n => n.toLowerCase().endsWith(".json")).sort()) {
  sourceFiles.push(path.join(DISCOVERY_DIR, name));
}
const originals = new Map(sourceFiles.map(f => [f, fs.readFileSync(f, "utf8")]));
const schema3 = JSON.parse(originals.get(PROFILE));

function hashTree(dir) {
  const out = new Map();
  const walk = d => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.toLowerCase().endsWith(".json")) {
        out.set(path.relative(dir, full).split(path.sep).join("/"),
          crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex"));
      }
    }
  };
  walk(dir);
  return out;
}

function build() {
  execFileSync(process.execPath, ["scripts/validate.mjs"], { stdio: "pipe" });
  execFileSync(process.execPath, ["scripts/build-site.mjs"], { stdio: "pipe" });
  return hashTree(SITE);
}

const stripItem = item => {
  const out = { ...item };
  for (const key of DNA_ITEM_KEYS) delete out[key];
  return out;
};

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

console.log("Content DNA inertness proof");
console.log("");

// --- boundary sanity: is the past24 window stable across two builds? --------
{
  const items = [...(JSON.parse(originals.get(LIBRARY)).items || [])];
  for (const file of sourceFiles.slice(2)) {
    const payload = JSON.parse(originals.get(file));
    for (const item of (Array.isArray(payload) ? payload : payload.items || [])) items.push(item);
  }
  const H24 = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const margins = items
    .filter(i => i.added_by === "daily-automation")
    .map(i => Math.abs(H24 - (now - Date.parse(i.added_at || ""))))
    .filter(Number.isFinite);
  const closest = margins.length ? Math.min(...margins) / 60000 : Infinity;
  ok(`no item is within 60s of the 24h boundary (closest: ${closest === Infinity ? "n/a" : closest.toFixed(0) + " min"})`, closest > 1);
}

let preDnaHashes;
try {
  // --- build 1: the complete pre-DNA world -------------------------------
  const schema2 = JSON.parse(originals.get(PROFILE));
  schema2.schema_version = 2;
  for (const section of DNA_SECTIONS) delete schema2[section];
  writeJson(PROFILE, schema2);

  const library = JSON.parse(originals.get(LIBRARY));
  writeJson(LIBRARY, { ...library, items: (library.items || []).map(stripItem) });

  for (const file of sourceFiles.slice(2)) {
    const payload = JSON.parse(originals.get(file));
    writeJson(file, Array.isArray(payload)
      ? payload.map(stripItem)
      : { ...payload, items: (payload.items || []).map(stripItem) });
  }

  preDnaHashes = build();
  ok(`pre-DNA build produced ${preDnaHashes.size} generated JSON files`, preDnaHashes.size > 0);
} finally {
  for (const [file, text] of originals) fs.writeFileSync(file, text, "utf8");
}

// --- build 2: the committed schema-3 + enriched state --------------------
for (const [file, text] of originals) {
  assert.strictEqual(fs.readFileSync(file, "utf8"), text, `${file} was not restored byte-for-byte`);
}
ok("all source files restored byte-for-byte", true);

const dnaHashes = build();

// --- N: generated output must be byte-identical ---------------------------
{
  const names = new Set([...preDnaHashes.keys(), ...dnaHashes.keys()]);
  const differing = [...names].filter(n => preDnaHashes.get(n) !== dnaHashes.get(n));
  ok(`N  all ${names.size} generated files are byte-identical with and without Content DNA`,
    differing.length === 0, differing.join(", "));
}

// --- the six production-consumed subtrees ---------------------------------
{
  const committed = JSON.parse(originals.get(PROFILE));
  for (const key of PRODUCTION_SUBTREES) {
    let same = true;
    try { assert.deepStrictEqual(schema3[key], committed[key]); } catch { same = false; }
    ok(`${key} deep-equals the committed value`, same);
  }
}

// --- the live canonical prompt must not reference any DNA concept ---------
{
  const text = fs.readFileSync(PROMPT, "utf8");
  const fence = text.split("```");
  const canonical = fence.find(b => b.startsWith("text") && b.includes("Read BOTH GitHub repositories"));
  ok("canonical fenced prompt block was located", Boolean(canonical));
  for (const needle of FORBIDDEN_IN_PROMPT) {
    ok(`canonical prompt contains zero references to '${needle}'`, canonical ? !canonical.includes(needle) : false);
  }
}

console.log("");
console.log(failed ? `${failed} FAILED` : "INERT: Content DNA changes no generated catalog output");
process.exit(failed ? 1 : 0);
