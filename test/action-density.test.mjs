// The v4 additive action_density migration, and the policy fence around it.
//
// T25 in the frozen architecture: the shape migration must be SEMANTICALLY
// invisible. Byte identity is deliberately NOT the invariant - inserting a JSON
// key legitimately reserializes a file, so a byte check would fail on a correct
// migration and tempt someone to weaken the real assertion.
//
// The second half is the more important half. MG-7 is ADDITIVE: action_density
// is descriptive only. It is not weighted, not required-known and referenced by
// no guardrail, which is precisely why the legacy records carrying null keep
// scoring exactly as they did. The MG-7.2 policy flip may only happen once
// legacy coverage is complete, so these assertions are the fence that stops it
// happening early and silently emptying DNA Match.
//
// Run with: node test/action-density.test.mjs

import fs from "node:fs";
import path from "node:path";
import { makePolicy, scoreItem, requiredFor, dnaEligible } from "../scripts/dna-score.mjs";
import { CANONICAL_DIMENSIONS } from "../scripts/registry.mjs";

let passed = 0, failed = 0;
const check = (id, description, condition, detail) => {
  if (condition) { passed++; console.log("  ok   " + id + "  " + description); }
  else { failed++; console.error("  FAIL " + id + "  " + description + (detail ? "\n         " + detail : "")); }
};

const profile = JSON.parse(fs.readFileSync("data/taste-profile.json", "utf8"));
const config = JSON.parse(fs.readFileSync("config/catalogs.json", "utf8"));
const policy = makePolicy(profile);

const items = [];
JSON.parse(fs.readFileSync("data/library.json", "utf8")).items.forEach(i => items.push(i));
for (const n of fs.readdirSync("data/discoveries").filter(f => f.endsWith(".json")).sort())
  JSON.parse(fs.readFileSync(path.join("data/discoveries", n), "utf8")).items.forEach(i => items.push(i));

const DIM = "action_density";
const registry = profile.dna_dimensions.dimensions.map(d => d.id);
const dimOf = id => profile.dna_dimensions.dimensions.find(d => d.id === id);
const row = config.catalogs.find(c => c.id === "scifi-action");

console.log("Action density (v4 additive)");
console.log("");

// ---------------------------------------------------------------- registry
check("AD1", "the registry declares exactly 28 dimensions",
  registry.length === 28 && profile.dna_dimensions.count === 28 && CANONICAL_DIMENSIONS.length === 28,
  registry.length + " / " + profile.dna_dimensions.count + " / " + CANONICAL_DIMENSIONS.length);

check("AD2", DIM + " sits immediately before action_intensity",
  registry.indexOf(DIM) >= 0 && registry[registry.indexOf(DIM) + 1] === "action_intensity",
  registry.slice(registry.indexOf(DIM) - 1, registry.indexOf(DIM) + 2).join(" -> "));

// ---------------------------------------------------------------- shape
check("AD3", "every source item carries an " + DIM + " key (" + items.length + " items)",
  items.every(i => Object.prototype.hasOwnProperty.call(i.dna, DIM)));

check("AD4", "every DNA vector is exactly the 28 registry keys",
  items.every(i => {
    const keys = Object.keys(i.dna);
    return keys.length === 28 && registry.every(d => keys.includes(d));
  }));

// ---------------------------------------------------------------- the fence
check("AD5", DIM + " is UNWEIGHTED",
  profile.dna_baseline.unweighted.includes(DIM) && !(DIM in profile.dna_baseline.weights));

check("AD6", DIM + " is NOT required-known",
  !profile.dna_baseline.completeness_defaults.required_known_dimensions.includes(DIM));

check("AD7", "NO guardrail references " + DIM,
  !JSON.stringify(profile.dna_guardrails).includes(DIM));

check("AD8", "weights U unweighted is exactly the 28-dimension registry, disjointly", (() => {
  const w = Object.keys(profile.dna_baseline.weights);
  const u = profile.dna_baseline.unweighted;
  return w.length + u.length === 28
    && !w.some(d => u.includes(d))
    && registry.every(d => w.includes(d) || u.includes(d));
})());

check("AD9", "DNA Match does NOT require " + DIM + ", so legacy rows are undisturbed", (() => {
  const def = config.catalogs.find(c => c.id === "dna-match");
  const req = requiredFor(policy, def);
  return req.length === 27 && !req.includes(DIM);
})(), "if this fails the MG-7.2 flip has happened and DNA Match will empty");

check("AD10", "minimum_match_score is still 82 and best_match_score still 90",
  profile.automation_rules.minimum_match_score === 82 && profile.automation_rules.best_match_score === 90);

// ---------------------------------------------------------------- the new row
check("AD11", "the scifi-action row exists and is a weighted DNA row",
  Boolean(row) && row.filter === "dna" && row.dna.mode === "weighted");

check("AD12", "its gate is " + DIM + " at_or_above 6",
  Boolean(row) && row.dna.gate.all_of.length === 1
  && row.dna.gate.all_of[0].dimension === DIM
  && row.dna.gate.all_of[0].at_or_above === 6
  && row.dna.gate.any_of.length === 0);

check("AD13", "density outweighs intensity in that row",
  Boolean(row) && row.dna.weights[DIM] > row.dna.weights.action_intensity);

check("AD14", "the row still rewards investigation and mystery, not action alone",
  Boolean(row) && row.dna.weights.scientific_investigation > 0 && row.dna.weights.mystery > 0);

check("AD15", "and it still penalises military / space-opera framing",
  Boolean(row) && row.dna.penalties.military_focus > 0 && row.dna.penalties.space_opera > 0);

// ---------------------------------------------------------------- unknown is never zero
check("AD16", "a null density can NEVER enter scifi-action", (() => {
  const nulls = items.filter(i => i.dna[DIM] === null);
  if (!nulls.length) return true;            // vacuous once the backfill completes
  return nulls.every(i => scoreItem(policy, row, i, new Map()).score === null);
})());

check("AD16b", "and the reason is the unmeasured density, not some other gap", (() => {
  // One legacy record is independently dna_ineligible on baseline completeness -
  // that predates MG-7 and has nothing to do with density. Every OTHER null
  // record must be held out by action_density specifically, which is what proves
  // the shape migration, and not some accident, is keeping the row empty.
  const nulls = items.filter(i => i.dna[DIM] === null && dnaEligible(policy, i));
  return nulls.length > 0
    && nulls.every(i => scoreItem(policy, row, i, new Map()).reason === "missing_required:" + DIM);
})());

check("AD17", "only a genuinely MEASURED density can put an item in the row", (() => {
  const inRow = items.filter(i => scoreItem(policy, row, i, new Map()).score !== null);
  return inRow.every(i => Number.isInteger(i.dna[DIM]) && i.dna[DIM] >= 6);
})());

// ---------------------------------------------------------------- corrected rubric
check("AD18", "the action_intensity rubric measures FORCE, not runtime share", (() => {
  const r = dimOf("action_intensity").rubric;
  return r["0"] === "none"
    && r["3"] === "minor scuffles"
    && r["5"] === "ordinary force and stakes when action occurs"
    && r["8"] === "large, punishing set pieces"
    && r["10"] === "peak sequences are extreme in force, scale and stakes";
})(), JSON.stringify(dimOf("action_intensity").rubric));

check("AD19", "the " + DIM + " rubric measures RUNTIME SHARE", (() => {
  const r = dimOf(DIM).rubric;
  return r["0"] === "essentially no action across the runtime"
    && r["3"] === "a few isolated action scenes in an otherwise low-action runtime"
    && r["5"] === "action recurs regularly, roughly a third of the runtime"
    && r["8"] === "action occupies most of the runtime"
    && r["10"] === "near-continuous action";
})(), JSON.stringify(dimOf(DIM).rubric));

check("AD20", "the old density-contaminated intensity anchors are gone", (() => {
  const text = JSON.stringify(dimOf("action_intensity").rubric);
  return !text.includes("action-driven throughout") && !text.includes("regular action");
})());

check("AD21", "the profile records that the two are independent and legacy intensity is unrevised", (() => {
  const text = profile.dna_dimensions.principles.independent_dimensions;
  return text.includes(DIM) && text.includes("action_intensity")
    && text.includes("null") && /rubric/i.test(text);
})());

// ---------------------------------------------------------------- nothing was inferred
check("AD22", "no density was derived from intensity: any non-null value is a real integer", (() => {
  return items.filter(i => i.dna[DIM] !== null).every(i => Number.isInteger(i.dna[DIM]));
})());

check("AD23", "no code or config derives density from intensity", (() => {
  const files = ["scripts/dna-score.mjs", "scripts/validate.mjs", "scripts/build-site.mjs"];
  return files.every(f => {
    const text = fs.readFileSync(f, "utf8");
    return !new RegExp(DIM + "\\s*=\\s*[^;]*action_intensity").test(text);
  });
})());

// ---------------------------------------------------------------- untouched rows
check("AD24", "every PRE-EXISTING DNA row still scores every eligible item", (() => {
  const defs = config.catalogs.filter(c => c.filter === "dna" && c.id !== "scifi-action");
  return items.filter(i => dnaEligible(policy, i)).every(it =>
    defs.every(d => !(scoreItem(policy, d, it, new Map()).reason || "").startsWith("missing_required")));
})());

check("AD25", "15 logical rows are declared", config.catalogs.length === 15, String(config.catalogs.length));

check("AD26", "the manifest id is unchanged",
  config.manifest.id === "com.github.wtfscifi.automated-watchlist", config.manifest.id);

// ---------------------------------------------------------------- coverage report
{
  const known = items.filter(i => Number.isInteger(i.dna[DIM])).length;
  const pct = items.length ? Math.round((known / items.length) * 1000) / 10 : 0;
  console.log("");
  console.log("  --   legacy " + DIM + " coverage: " + known + "/" + items.length + " (" + pct + "%)");
  console.log("       MG-7.2 (backfill + policy flip) requires 100% before action_density");
  console.log("       may become required-known or enter dna_baseline.weights.");
}

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
