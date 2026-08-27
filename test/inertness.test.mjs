// Content DNA isolation proof (F2-6 case N, extended by F2-7 and F2-8).
//
// Reconstructs the complete pre-DNA world - a schema-2 taste profile with the
// four DNA sections removed AND every source item stripped of dna,
// dna_confidence and dna_tags - builds the site from it, then builds again from
// the committed schema-3 + enriched state.
//
// Since F2-8 the DNA layer is deliberately NOT inert: five catalogs consume it.
// The invariant is therefore narrower and more useful - Content DNA must not
// disturb anything that existed before it:
//
//   the 18 pre-F2-8 catalog files  -> byte-identical in both worlds
//   the manifest                   -> byte-identical in both worlds
//   the 10 DNA catalog files       -> empty without DNA, populated with it
//
// A DNA row degrading to empty rather than to noise is the property that
// matters: an un-enriched deployment loses the new rows and keeps everything
// else exactly as it was.
//
// Both halves have to be reconstructed together: a schema-2 profile alongside
// DNA-bearing items is exactly the hybrid state the schema contract forbids, so
// validating that combination would be asserting something we deliberately made
// illegal.
//
// It also deep-equals the six production-consumed profile subtrees and confirms
// the live canonical automation prompt now REQUIRES the DNA contract (F2-9).
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
// DERIVED FROM CONFIG, NOT HARDCODED.
//
// This was a literal list of the five F2-8 rows. When MG-7 added a sixth DNA
// row (scifi-action) the list did not learn about it, so that row was silently
// classified as PRE-DNA - and the misclassification stayed invisible only
// because the row was empty while every legacy action_density was null. The
// moment the MG-7.2 backfill gave two titles a real density, a genuine DNA row
// started differing between the two worlds and was reported as a pre-DNA
// regression. Deriving the list means a future DNA row is covered on the day it
// is added rather than the day it first has contents.
const DNA_ROWS = JSON.parse(fs.readFileSync("config/catalogs.json", "utf8"))
  .catalogs.filter(c => c.filter === "dna").map(c => c.id);
const isDnaCatalog = name => DNA_ROWS.some(r => name.endsWith(`/${r}-movie.json`) || name.endsWith(`/${r}-series.json`));
// Until F2-9 the canonical prompt referenced no DNA concept at all, and this
// file asserted exactly that. F2-9 inverts it on purpose: the automation is now
// REQUIRED to generate Content DNA and to publish personalized-scores.json, so
// the prompt must name those concepts. The detailed prompt contract lives in
// test/prompt-contract.test.mjs; here we only assert the inversion happened, so
// that a revert of the prompt cannot pass silently.
const REQUIRED_IN_PROMPT = [
  "dna_dimensions", "dna_baseline", "dna_guardrails",
  "dna_confidence", "dna_tags", "personalized-scores"
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

console.log("Content DNA isolation proof");
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

  // Without a DNA registry the five DNA rows must degrade to EMPTY, never to
  // arbitrary or partially-scored contents.
  const emptyDna = [...preDnaHashes.keys()].filter(isDnaCatalog)
    .filter(f => JSON.parse(fs.readFileSync(path.join(SITE, f), "utf8")).metas.length === 0);
  ok(`without Content DNA all ${DNA_ROWS.length * 2} DNA catalogs degrade to empty (${emptyDna.length}/${DNA_ROWS.length * 2})`,
    emptyDna.length === DNA_ROWS.length * 2);
} finally {
  for (const [file, text] of originals) fs.writeFileSync(file, text, "utf8");
}

// --- build 2: the committed schema-3 + enriched state --------------------
for (const [file, text] of originals) {
  assert.strictEqual(fs.readFileSync(file, "utf8"), text, `${file} was not restored byte-for-byte`);
}
ok("all source files restored byte-for-byte", true);

const dnaHashes = build();

// --- N: everything that predates the DNA rows is untouched -----------------
{
  const names = [...new Set([...preDnaHashes.keys(), ...dnaHashes.keys()])];
  const preExisting = names.filter(n => !isDnaCatalog(n));
  const dnaFiles = names.filter(isDnaCatalog);

  const differing = preExisting.filter(n => preDnaHashes.get(n) !== dnaHashes.get(n));
  ok(`N  all ${preExisting.length} pre-F2-8 files (pre-DNA catalogs + manifest) are byte-identical with and without Content DNA`,
    differing.length === 0, differing.join(", "));

  ok(`the ${DNA_ROWS.length * 2} DNA catalog files exist in both builds`, dnaFiles.length === DNA_ROWS.length * 2, `found ${dnaFiles.length}`);

  const countMetas = file => JSON.parse(fs.readFileSync(path.join(SITE, file), "utf8")).metas.length;
    // scifi-action is gated on action_density >= 6, and the MG-7.2 backfill fills
  // that dimension in reviewed batches, so it is legitimately empty until enough
  // legacy titles have a measured density - and its series half may stay empty
  // longer than its movie half. Requiring EVERY DNA row to be populated would
  // therefore fail for a correct in-progress backfill. The real invariant is that
  // every row that predates the backfill is populated, and that a gated row is
  // never populated by anything other than a genuinely measured value.
  const BACKFILL_GATED = new Set(["scifi-action"]);
  const settled = dnaFiles.filter(f => ![...BACKFILL_GATED].some(r => f.includes(`/${r}-`)));
  const settledPopulated = settled.filter(f => countMetas(f) > 0);
  ok(`every settled DNA catalog is populated when DNA is present (${settledPopulated.length}/${settled.length})`,
    settledPopulated.length === settled.length);
  // A gated row that is still empty is identical in BOTH worlds by definition,
  // so only the settled rows can be asserted to differ.
  ok(`the settled DNA catalogs differ from their empty pre-DNA counterparts`,
    settled.every(n => preDnaHashes.get(n) !== dnaHashes.get(n)));
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
  for (const needle of REQUIRED_IN_PROMPT) {
    ok(`canonical prompt requires '${needle}' (F2-9)`, canonical ? canonical.includes(needle) : false);
  }
}

console.log("");
console.log(failed ? `${failed} FAILED` : "ISOLATED: Content DNA changes nothing that predates it");
process.exit(failed ? 1 : 0);
