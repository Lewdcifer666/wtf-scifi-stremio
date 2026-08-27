// MG-7.3 high-impact evidence audit: append review sources, and apply only those
// value corrections that a substantive source actually contradicts.
//
// Writes action_density, action_intensity and source. Nothing else. Existing
// provenance is never removed - the pre-existing URL set must remain a subset.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const plan = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const APPLY = process.argv.includes("--apply");
const fail = m => { console.error("FATAL: " + m); process.exit(1); };

const tok = s => String(s || "").split(/[;,\s]+/).flatMap(t => {
  try { const u = new URL(t.trim()); if (!/^https?:$/.test(u.protocol)) return []; u.hash = ""; return [u.href]; } catch { return []; }
});

const want = new Map(plan.map(p => [p.imdb_id, p]));
const targets = ["data/library.json", ...fs.readdirSync(path.join(root, "data/discoveries"))
  .filter(f => f.endsWith(".json")).sort().map(f => `data/discoveries/${f}`)];

const changes = [];
for (const rel of targets) {
  const file = path.join(root, rel);
  const raw = fs.readFileSync(file, "utf8");
  const before = JSON.parse(raw);
  const after = JSON.parse(raw);
  let touched = false;

  after.items.forEach((item, i) => {
    const p = want.get(item.imdb_id);
    if (!p) return;
    const pre = before.items[i];
    const rec = { imdb_id: item.imdb_id, title: item.title, file: rel, added_sources: [], density: null, intensity: null };

    if (p.add_sources && p.add_sources.length) {
      const have = new Set(tok(item.source));
      const add = p.add_sources.filter(u => !have.has(u));
      if (add.length) { item.source = item.source + " ; " + add.join(" ; "); rec.added_sources = add; touched = true; }
    }
    if (Number.isInteger(p.action_density) && p.action_density !== item.dna.action_density) {
      rec.density = { from: item.dna.action_density, to: p.action_density }; item.dna.action_density = p.action_density; touched = true;
    }
    if (Number.isInteger(p.action_intensity) && p.action_intensity !== item.dna.action_intensity) {
      rec.intensity = { from: item.dna.action_intensity, to: p.action_intensity }; item.dna.action_intensity = p.action_intensity; touched = true;
    }
    if (rec.added_sources.length || rec.density || rec.intensity) changes.push(rec);

    const strip = d => { const c = { ...d }; delete c.action_density; delete c.action_intensity; return c; };
    if (JSON.stringify(strip(item.dna)) !== JSON.stringify(strip(pre.dna))) fail(`${item.title}: another DNA dimension changed`);
    const a = { ...item }, b = { ...pre }; delete a.dna; delete b.dna; delete a.source; delete b.source;
    if (JSON.stringify(a) !== JSON.stringify(b)) fail(`${item.title}: a non-DNA field changed`);
    const post = new Set(tok(item.source));
    if (!tok(pre.source).every(u => post.has(u))) fail(`${item.title}: existing provenance removed`);
    const list = tok(item.source);
    if (list.length !== new Set(list).size) fail(`${item.title}: duplicate citation introduced`);
  });

  if (touched && APPLY) {
    const eol = raw.includes("\r\n") ? "\r\n" : "\n";
    fs.writeFileSync(file, JSON.stringify(after, null, 2).replace(/\n/g, eol) + eol);
  }
}

const missing = [...want.keys()].filter(id => !changes.some(c => c.imdb_id === id) && want.get(id).add_sources?.length);
if (missing.length) fail(`plan ids not applied: ${missing.join(", ")}`);
fs.writeFileSync(process.argv[3], JSON.stringify(changes, null, 2) + "\n");
console.log(`${APPLY ? "APPLIED" : "DRY RUN"}  items touched=${changes.length}`);
console.log(`  sources appended : ${changes.filter(c => c.added_sources.length).length}`);
console.log(`  density corrected: ${changes.filter(c => c.density).length}`);
console.log(`  intensity corrected: ${changes.filter(c => c.intensity).length}`);
for (const c of changes.filter(c => c.density || c.intensity))
  console.log(`    ${c.title.padEnd(24)} ${c.density ? `d ${c.density.from}->${c.density.to}` : "       "}  ${c.intensity ? `i ${c.intensity.from}->${c.intensity.to}` : ""}`);
