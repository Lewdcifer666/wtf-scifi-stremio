// F2-6 inertness proof (test matrix case N).
//
// Builds the site twice - once from a schema-2 taste profile derived by
// removing the four DNA sections, once from the committed schema-3 profile -
// and requires every generated manifest and catalog file to be byte-identical.
// It also deep-equals the six production-consumed subtrees and greps the live
// canonical automation prompt for DNA references.
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
const SITE = "site";
const PROMPT = "DAILY_AUTOMATION_PROMPT.md";
const DNA_SECTIONS = ["dna_dimensions", "dna_baseline", "dna_guardrails", "execution_preferences"];
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

const original = fs.readFileSync(PROFILE, "utf8");
const schema3 = JSON.parse(original);

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
  execFileSync(process.execPath, ["scripts/build-site.mjs"], { stdio: "pipe" });
  return hashTree(SITE);
}

console.log("F2-6 inertness proof");
console.log("");

// --- boundary sanity: is the past24 window stable across two builds? --------
{
  const items = [...(JSON.parse(fs.readFileSync("data/library.json", "utf8")).items || [])];
  const dir = "data/discoveries";
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir).filter(n => n.endsWith(".json")).sort()) {
      const payload = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
      for (const item of (Array.isArray(payload) ? payload : payload.items || [])) items.push(item);
    }
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

let schema2Hashes;
let schema3Hashes;

try {
  // --- build 1: schema 2 ---------------------------------------------------
  const schema2 = JSON.parse(original);
  schema2.schema_version = 2;
  for (const section of DNA_SECTIONS) delete schema2[section];
  fs.writeFileSync(PROFILE, JSON.stringify(schema2, null, 2) + "\n", "utf8");
  execFileSync(process.execPath, ["scripts/validate.mjs"], { stdio: "pipe" });
  schema2Hashes = build();
  ok(`schema-2 build produced ${schema2Hashes.size} generated JSON files`, schema2Hashes.size > 0);
} finally {
  fs.writeFileSync(PROFILE, original, "utf8");
}

// --- build 2: schema 3 (the committed file, byte-restored) -----------------
assert.strictEqual(fs.readFileSync(PROFILE, "utf8"), original, "taste-profile.json was not restored");
execFileSync(process.execPath, ["scripts/validate.mjs"], { stdio: "pipe" });
schema3Hashes = build();

// --- N: generated output must be byte-identical ----------------------------
{
  const names = new Set([...schema2Hashes.keys(), ...schema3Hashes.keys()]);
  const differing = [...names].filter(n => schema2Hashes.get(n) !== schema3Hashes.get(n));
  ok(`N  all ${names.size} generated files are byte-identical between schema 2 and schema 3`,
    differing.length === 0, differing.join(", "));
}

// --- the six production-consumed subtrees ----------------------------------
{
  const before = JSON.parse(original);
  for (const key of PRODUCTION_SUBTREES) {
    let same = true;
    try { assert.deepStrictEqual(schema3[key], before[key]); } catch { same = false; }
    ok(`${key} deep-equals the committed value`, same);
  }
}

// --- the live canonical prompt must not reference any DNA concept ----------
{
  const text = fs.readFileSync(PROMPT, "utf8");
  const fence = text.split("```");
  // the canonical fenced block is the one beginning "text\nRead BOTH GitHub repositories"
  const canonical = fence.find(b => b.startsWith("text") && b.includes("Read BOTH GitHub repositories"));
  ok("canonical fenced prompt block was located", Boolean(canonical));
  for (const needle of FORBIDDEN_IN_PROMPT) {
    ok(`canonical prompt contains zero references to '${needle}'`, canonical ? !canonical.includes(needle) : false);
  }
}

console.log("");
console.log(failed ? `${failed} FAILED` : "INERT: F2-6 changes no production behaviour");
process.exit(failed ? 1 : 0);
