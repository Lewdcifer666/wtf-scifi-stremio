// MG-7.2 backfill applier. Writes ONLY action_density and action_intensity.
//
// Both values are RESEARCHED, never derived from one another. This tool cannot
// compute either: it only transcribes reviewed values from a batch file and then
// proves it changed nothing else.
//
// The batch file is [{ imdb_id, action_density, action_intensity, note }].
// `note` is migration reasoning and is deliberately NOT written to the public
// item - the public `reason` is card text and must not become a migration log.
//
// Refuses to run unless, for every touched record:
//   deepEqual(pre.dna minus the two dimensions, post.dna minus the two)
//   every non-DNA field identical
//   source unchanged, or the pre-existing URL set is a SUBSET of the new one
//
// Run: node tools/migrations/apply-action-backfill.mjs <batch.json> [--apply]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const batch = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const APPLY = process.argv.includes("--apply");

const legacy = JSON.parse(fs.readFileSync(path.join(root, "tools/migrations/mg7-legacy-set.json"), "utf8"));
const legacyIds = new Set(legacy.identities);
const fail = m => { console.error("FATAL: " + m); process.exit(1); };

const wanted = new Map();
for (const e of batch) {
  if (!legacyIds.has(e.imdb_id)) fail(`${e.imdb_id} is not in the frozen MG-7 legacy set - refusing to touch a post-MG-7 discovery`);
  for (const k of ["action_density", "action_intensity"]) {
    if (!Number.isInteger(e[k]) || e[k] < 0 || e[k] > 10) fail(`${e.imdb_id}: ${k} must be an integer 0..10, got ${JSON.stringify(e[k])}`);
  }
  if (!e.note || String(e.note).trim().length < 10) fail(`${e.imdb_id}: a migration note is required`);
  if (wanted.has(e.imdb_id)) fail(`${e.imdb_id} appears twice in the batch`);
  wanted.set(e.imdb_id, e);
}

const tokens = s => String(s || "").split(/[;,\s]+/).flatMap(t => {
  try { const u = new URL(t.trim()); if (!/^https?:$/.test(u.protocol)) return []; u.hash = ""; return [u.href]; }
  catch { return []; }
});

const targets = ["data/library.json",
  ...fs.readdirSync(path.join(root, "data/discoveries")).filter(f => f.endsWith(".json")).sort()
    .map(f => `data/discoveries/${f}`)];

const changes = [];
let touched = 0;

for (const rel of targets) {
  const file = path.join(root, rel);
  const raw = fs.readFileSync(file, "utf8");
  const before = JSON.parse(raw);
  const after = JSON.parse(raw);
  let changed = false;

  after.items.forEach((item, i) => {
    const e = wanted.get(item.imdb_id);
    if (!e) return;
    const pre = before.items[i];
    if (pre.dna.action_density !== null) {
      fail(`${item.title}: action_density is already ${pre.dna.action_density} - refusing to overwrite researched work`);
    }
    changes.push({
      imdb_id: item.imdb_id, title: item.title, year: item.year, type: item.type, file: rel,
      density: e.action_density,
      intensity_old: pre.dna.action_intensity, intensity_new: e.action_intensity,
      intensity_delta: e.action_intensity - pre.dna.action_intensity,
      note: e.note
    });
    item.dna.action_density = e.action_density;
    item.dna.action_intensity = e.action_intensity;
    changed = true;
    touched++;
  });

  if (!changed) continue;

  // ---- prove the blast radius before writing anything ----
  after.items.forEach((item, i) => {
    const pre = before.items[i];
    const strip = d => { const c = { ...d }; delete c.action_density; delete c.action_intensity; return c; };
    if (JSON.stringify(strip(item.dna)) !== JSON.stringify(strip(pre.dna))) fail(`${item.title}: another DNA dimension changed`);
    const a = { ...item }, b = { ...pre };
    delete a.dna; delete b.dna; delete a.source; delete b.source;
    if (JSON.stringify(a) !== JSON.stringify(b)) fail(`${item.title}: a non-DNA field changed`);
    const preUrls = tokens(pre.source), postUrls = new Set(tokens(item.source));
    if (!preUrls.every(u => postUrls.has(u))) fail(`${item.title}: existing provenance was removed`);
  });

  if (APPLY) {
    // text-level edit keeps every untouched record byte-identical
    const eol = raw.includes("\r\n") ? "\r\n" : "\n";
    let out = raw;
    for (const item of after.items) {
      const e = wanted.get(item.imdb_id);
      if (!e) continue;
      const pre = before.items.find(x => x.imdb_id === item.imdb_id);
      const pretty = /\n\s+"action_density":/.test(raw);
      const dOld = pretty ? `"action_density": null` : `"action_density":null`;
      const dNew = pretty ? `"action_density": ${e.action_density}` : `"action_density":${e.action_density}`;
      const iOld = pretty ? `"action_intensity": ${pre.dna.action_intensity}` : `"action_intensity":${pre.dna.action_intensity}`;
      const iNew = pretty ? `"action_intensity": ${e.action_intensity}` : `"action_intensity":${e.action_intensity}`;
      const block = out.indexOf(`"imdb_id": "${item.imdb_id}"`) >= 0
        ? `"imdb_id": "${item.imdb_id}"` : `"imdb_id":"${item.imdb_id}"`;
      const at = out.indexOf(block);
      if (at < 0) fail(`${item.title}: record not found in text`);
      const end = out.indexOf(`"dna_confidence"`, at);
      let seg = out.slice(at, end);
      if (!seg.includes(dOld)) fail(`${item.title}: null density not found in its record`);
      if (!seg.includes(iOld)) fail(`${item.title}: expected intensity ${pre.dna.action_intensity} not found`);
      seg = seg.replace(dOld, dNew).replace(iOld, iNew);
      out = out.slice(0, at) + seg + out.slice(end);
    }
    JSON.parse(out);
    fs.writeFileSync(file, out);
  }
}

const missing = [...wanted.keys()].filter(id => !changes.some(c => c.imdb_id === id));
if (missing.length) fail(`batch ids not found in any data file: ${missing.join(", ")}`);

fs.writeFileSync(process.argv[3] || "/dev/null", JSON.stringify(changes, null, 2) + "\n");
console.log(`${APPLY ? "APPLIED" : "DRY RUN"}  titles=${touched}`);
console.log(`intensity changed on ${changes.filter(c => c.intensity_delta !== 0).length} of ${touched}`);
