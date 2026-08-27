// ONE-TIME v4 SHAPE MIGRATION: add action_density to every enriched record.
//
// THIS SCRIPT RESEARCHES NOTHING AND INFERS NOTHING.
//
// It inserts exactly one key - "action_density": null - into every existing DNA
// object, immediately BEFORE action_intensity so the two sit adjacent and the
// distinction between them is visible in every record:
//
//   action_density    how MUCH of the runtime contains action
//   action_intensity  how HARD the action hits WHEN it occurs
//
// null is the honest in-band representation of "not yet measured". Unknown is
// never zero anywhere in this engine, so a null density cannot satisfy a gate,
// cannot dodge a guardrail and cannot be read as "no action". Deriving a value
// from action_intensity, from a trailer or from a genre label would be exactly
// the contamination the split exists to remove, so nothing here does it.
//
// The edit is performed on the FILE TEXT, not by reserializing the parsed JSON,
// so every untouched record keeps its exact byte formatting and the diff is one
// added key per record and nothing else. The parsed form is still used for the
// safety checks below.
//
// Idempotent, and fails LOUDLY rather than half-applying:
//   - a record already carrying action_density: null is left alone
//   - a NON-NULL action_density before the backfill aborts the run, because
//     overwriting it would be indistinguishable from erasing researched work
//   - an unexpected DNA key set aborts the run
//   - an item whose dna lacks the anchor aborts the run
//
// Run:  node scripts/migrations/2026-08-v4-action-density.mjs [--apply]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const APPLY = process.argv.includes("--apply");

const NEW_DIMENSION = "action_density";
const ANCHOR = "action_intensity";

const profile = JSON.parse(fs.readFileSync(path.join(root, "data/taste-profile.json"), "utf8"));
const registry = profile.dna_dimensions.dimensions.map(d => d.id);
if (!registry.includes(NEW_DIMENSION)) {
  console.error(`FATAL: ${NEW_DIMENSION} is not in the profile registry. Update the profile first.`);
  process.exit(1);
}
const legacyKeys = registry.filter(id => id !== NEW_DIMENSION);

const fail = message => { console.error(`FATAL: ${message}`); process.exit(1); };

let records = 0, inserted = 0, alreadyDone = 0;
const targets = [
  "data/library.json",
  ...fs.readdirSync(path.join(root, "data/discoveries"))
    .filter(f => f.endsWith(".json")).sort().map(f => `data/discoveries/${f}`)
];

for (const rel of targets) {
  const file = path.join(root, rel);
  const raw = fs.readFileSync(file, "utf8");
  const parsed = JSON.parse(raw);

  let toInsert = 0;
  for (const item of parsed.items) {
    records++;
    const dna = item.dna;
    if (!dna || typeof dna !== "object") fail(`${rel} ${item.title}: no dna object`);

    if (Object.prototype.hasOwnProperty.call(dna, NEW_DIMENSION)) {
      if (dna[NEW_DIMENSION] !== null) {
        fail(`${rel} ${item.title}: ${NEW_DIMENSION} is already ${JSON.stringify(dna[NEW_DIMENSION])}. ` +
          `The pure shape migration must never run over researched values.`);
      }
      alreadyDone++;
      continue;
    }

    const keys = Object.keys(dna);
    const missing = legacyKeys.filter(k => !keys.includes(k));
    const extra = keys.filter(k => !legacyKeys.includes(k));
    if (missing.length || extra.length) {
      fail(`${rel} ${item.title}: unexpected DNA key set (missing: ${missing.join(",") || "none"}; ` +
        `extra: ${extra.join(",") || "none"})`);
    }
    if (!keys.includes(ANCHOR)) fail(`${rel} ${item.title}: anchor ${ANCHOR} missing`);
    toInsert++;
  }

  // Text edit. action_intensity occurs exactly once per record and only inside a
  // dna object, which is asserted below, so the replacement cannot stray.
  const pretty = /\n\s+"action_intensity":/.test(raw);
  const pattern = pretty ? /(\r?\n)(\s*)"action_intensity":/g : /"action_intensity":/g;
  const occurrences = (raw.match(pattern) || []).length;
  if (occurrences !== parsed.items.length) {
    fail(`${rel}: found ${occurrences} textual ${ANCHOR} occurrences for ${parsed.items.length} items`);
  }

  let out = raw;
  if (toInsert > 0) {
    out = pretty
      ? raw.replace(pattern, (m, nl, indent) => `${nl}${indent}"${NEW_DIMENSION}": null,${nl}${indent}"${ANCHOR}":`)
      : raw.replace(pattern, `"${NEW_DIMENSION}":null,"${ANCHOR}":`);
    inserted += toInsert;

    // Prove the result before writing it.
    const after = JSON.parse(out);
    if (after.items.length !== parsed.items.length) fail(`${rel}: item count changed`);
    after.items.forEach((item, i) => {
      const before = parsed.items[i];
      if (item.dna[NEW_DIMENSION] !== null) fail(`${rel} ${item.title}: density is not null after migration`);
      const stripped = { ...item.dna };
      delete stripped[NEW_DIMENSION];
      if (JSON.stringify(stripped) !== JSON.stringify(before.dna)) {
        fail(`${rel} ${item.title}: pre-existing DNA changed`);
      }
      const a = { ...item }, b = { ...before };
      delete a.dna; delete b.dna;
      if (JSON.stringify(a) !== JSON.stringify(b)) fail(`${rel} ${item.title}: a non-DNA field changed`);
    });
  }

  if (APPLY) fs.writeFileSync(file, out);
}

console.log(`${APPLY ? "APPLIED" : "DRY RUN"}  records=${records}  inserted=${inserted}  already-null=${alreadyDone}`);
console.log(`non-null legacy densities written: 0 (by construction - this script never writes a value)`);
