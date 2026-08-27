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
import { makePolicy, scoreItem, requiredFor, dnaEligible, bestArchetype, evalRule } from "../scripts/dna-score.mjs";
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
// STILL UNWEIGHTED, AND THAT IS A CALIBRATED RESULT, NOT AN OVERSIGHT.
//
// The baseline score is a normalised weighted average: contentBase =
// 100 * raw / baseMax. Adding weight W for a dimension raises raw by W*value and
// baseMax by 10W, so a title gains only when value*10 > its current contentBase.
// Measured across the completed 127-title set, that condition holds for 19
// titles and fails for 95 - and the 19 are the LOWEST-scoring ones in the
// corpus. A positive density weight would therefore lift the weakest Sci-Fi fits
// and depress the strongest, which is precisely the "generic action with lasers"
// outcome the profile exists to avoid. Simulated at W = 0, 2, 4, 6, 8 and 10;
// every positive value reduced the mean and cut the number of titles at or above
// 82. Sustained action is allowed to help by NO LONGER BEING PENALISED, not by
// being rewarded in the average.
check("AD5", DIM + " is UNWEIGHTED (calibrated: no positive weight helps)",
  profile.dna_baseline.unweighted.includes(DIM) && !(DIM in profile.dna_baseline.weights));

// MG-7.2 FLIPPED THIS. During the backfill action_density had to stay optional,
// because 127 legacy records carried null and requiring it would have emptied
// DNA Match. Coverage is now 127/127, so an unknown density is no longer a
// legacy gap - it is an unresearched new discovery, and those must not score.
check("AD6", DIM + " IS required-known now that coverage is complete",
  profile.dna_baseline.completeness_defaults.required_known_dimensions.includes(DIM));

check("AD6b", "and every source item actually satisfies it",
  items.every(i => Number.isInteger(i.dna[DIM])),
  items.filter(i => !Number.isInteger(i.dna[DIM])).map(i => i.title).join(", "));

// The action-first guardrail now asks about RUNTIME SHARE, which is what
// "action-first" always meant, instead of peak force. action_intensity must NOT
// appear in any guardrail any more: a single savage sequence is not evidence
// that a film is action-first.
check("AD7", "the action-first guardrail keys on " + DIM + ", not peak force", (() => {
  const g = profile.dna_guardrails.combination.find(c => c.id === "action_first_without_investigation");
  return Boolean(g)
    && g.any_of.some(c => c.dimension === DIM && c.at_or_above === 6)
    && !g.any_of.some(c => c.dimension === "action_intensity");
})());

check("AD7b", "NO guardrail anywhere still references action_intensity",
  !JSON.stringify(profile.dna_guardrails).includes("action_intensity"));

check("AD8", "weights U unweighted is exactly the 28-dimension registry, disjointly", (() => {
  const w = Object.keys(profile.dna_baseline.weights);
  const u = profile.dna_baseline.unweighted;
  return w.length + u.length === 28
    && !w.some(d => u.includes(d))
    && registry.every(d => w.includes(d) || u.includes(d));
})());

// The additive invariant was "DNA Match requires 27 of the 28". That was correct
// only while density was unmeasured. The final invariant is that DNA Match
// requires ALL 28 - it now demands a researched density - while action_density
// remains UNWEIGHTED, which is the calibrated outcome: see AD5.
check("AD9", "DNA Match now requires all 28 dimensions, including " + DIM, (() => {
  const def = config.catalogs.find(c => c.id === "dna-match");
  const req = requiredFor(policy, def);
  return req.length === 28 && req.includes(DIM);
})());

check("AD9b", "and no item is excluded from DNA Match for a missing density", (() => {
  const def = config.catalogs.find(c => c.id === "dna-match");
  return items.every(i => (scoreItem(policy, def, i, new Map()).reason || "") !== "missing_required:" + DIM);
})());

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
  // During the backfill this proved the row was held open by the unmeasured
  // density specifically rather than by some unrelated gap. Once coverage
  // reaches 100% there are no nulls left and the check is vacuously satisfied -
  // which is the intended end state, not a hole. AD16 still holds the invariant
  // for any null that ever reappears.
  const nulls = items.filter(i => i.dna[DIM] === null && dnaEligible(policy, i));
  return nulls.every(i => scoreItem(policy, row, i, new Map()).reason === "missing_required:" + DIM);
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

// ---------------------------------------------------------------- MG-7.3
// The final action SEMANTICS. MG-7.2 fixed the dimensional mismatch by moving
// the old action_intensity penalties onto action_density; MG-7.3 asked the
// separate question of whether that inherited PREFERENCE should have survived
// the rubric change at all, and concluded it should not.
//
// The intended end state:
//   low-action excellent Sci-Fi is not punished for lacking action
//   high-action excellent Sci-Fi gets a SMALL advantage, via archetypes only
//   generic high-action weak-Sci-Fi is still strongly penalised

// A realistic Sci-Fi shape: mid values everywhere, and the dimensions this
// profile penalises set to 0 rather than 5. A fixture carrying military 5,
// superhero 5 and comedy 5 is not a Sci-Fi title and would drag every score
// down for reasons unrelated to what is being tested.
const PENALISED = ["horror", "military_focus", "space_opera", "superhero",
  "comic_book_universe", "comedy", "survival_chase", "creature_threat"];
const fx = over => {
  const dna = Object.fromEntries(registry.map(d => [d, 5]));
  for (const n of PENALISED) dna[n] = 0;
  return { imdb_id: "tt0000001", type: "movie", title: "fx", year: 2020, status: "watch",
    dna_confidence: 0.9, dna: { ...dna, ...over } };
};
const dnaMatch = config.catalogs.find(c => c.id === "dna-match");
const scoreOf = item => scoreItem(policy, dnaMatch, item, new Map()).score;
const STRONG = { scientific_investigation: 8, rule_discovery: 8, concept_escalation: 8, mystery: 8, unknown_phenomenon: 8, suspense: 7 };
const WEAK = { scientific_investigation: 2, rule_discovery: 2, concept_escalation: 2, mystery: 2, unknown_phenomenon: 2 };

// -- A: the documentation matches the executable policy ----------------------
{
  const note = profile.dna_baseline.unweighted_note;
  const stale = [
    "is not required-known", "not required-known", "referenced by no guardrail",
    "no guardrail references it", "awaiting", "until the backfill", "backfill reaches",
    "descriptive-only for now", "It earns a scoring role only after the backfill"
  ];
  check("MG73-A1", "unweighted_note carries none of the stale MG-7 claims",
    !stale.some(t => note.includes(t)), stale.filter(t => note.includes(t)).join(" | "));
  check("MG73-A2", "and it states the two action dimensions ARE required-known and researched",
    /REQUIRED-KNOWN AND FULLY RESEARCHED/i.test(note));
  check("MG73-A3", "every dimension the note calls unweighted really is",
    profile.dna_baseline.unweighted.every(d => !(d in profile.dna_baseline.weights)));
}

// -- B, C, D: completeness ---------------------------------------------------
check("MG73-B", "action_density is required-known",
  profile.dna_baseline.completeness_defaults.required_known_dimensions.includes("action_density"));
check("MG73-C", "action_intensity is required-known even though it is unweighted",
  profile.dna_baseline.completeness_defaults.required_known_dimensions.includes("action_intensity")
  && !("action_intensity" in profile.dna_baseline.weights));
check("MG73-D", "DNA Match requires all 28 dimensions", requiredFor(policy, dnaMatch).length === 28);

// -- E, F: neither action dimension inherently lowers fit --------------------
check("MG73-E", "raising PEAK FORCE alone never lowers a title's baseline fit", (() => {
  const lo = scoreOf(fx({ ...STRONG, action_density: 2, action_intensity: 2 }));
  const hi = scoreOf(fx({ ...STRONG, action_density: 2, action_intensity: 9 }));
  return hi >= lo;
})());
check("MG73-F", "raising DENSITY alone never lowers an otherwise strong Sci-Fi title", (() => {
  const lo = scoreOf(fx({ ...STRONG, action_density: 1, action_intensity: 6 }));
  const hi = scoreOf(fx({ ...STRONG, action_density: 8, action_intensity: 6 }));
  return hi >= lo;
})());

// -- G, H: action may help, absence of action must not hurt ------------------
check("MG73-G", "a high-density strong-concept title is not worse than its low-density twin", (() => {
  const lo = scoreOf(fx({ ...STRONG, action_density: 1, action_intensity: 6 }));
  const hi = scoreOf(fx({ ...STRONG, action_density: 7, action_intensity: 7 }));
  return hi >= lo;
})());
check("MG73-G2", "and an action archetype is what makes that possible", (() => {
  const a = bestArchetype(policy, fx({ ...STRONG, action_density: 7, action_intensity: 7 }).dna);
  return Boolean(a) && ["investigative_scifi_action", "rule_discovery_action", "high_concept_action"].includes(a.id);
})());
check("MG73-H", "a LOW-density strong-concept title still scores excellently",
  scoreOf(fx({ ...STRONG, action_density: 0, action_intensity: 1 })) >= 80,
  String(scoreOf(fx({ ...STRONG, action_density: 0, action_intensity: 1 }))));

// -- I, J, K, L: the action-first guardrail -----------------------------------
const guard = profile.dna_guardrails.combination.find(c => c.id === "action_first_without_investigation");
const firesOn = over => evalRule(guard, fx(over).dna);
check("MG73-I", "high density + weak substance IS action-first",
  firesOn({ ...WEAK, action_density: 8, action_intensity: 8 }));
check("MG73-J", "low scientific_investigation but HIGH rule/mystery/concept is NOT action-first",
  !firesOn({ scientific_investigation: 2, rule_discovery: 9, mystery: 8, concept_escalation: 8, action_density: 8, action_intensity: 8 }));
check("MG73-K", "military 8 WITH strong discovery/concept is NOT action-first",
  !firesOn({ scientific_investigation: 2, rule_discovery: 9, mystery: 8, concept_escalation: 8, military_focus: 8, action_density: 4 }));
check("MG73-L", "military 8 WITH weak discovery/concept IS action-first",
  firesOn({ ...WEAK, military_focus: 8, action_density: 4 }));
check("MG73-J2", "and the strong-concept high-action title still scores well",
  scoreOf(fx({ scientific_investigation: 2, rule_discovery: 9, mystery: 8, concept_escalation: 8, unknown_phenomenon: 7, action_density: 8, action_intensity: 8 })) >= 70);

// -- M: no blind action penalty survives anywhere -----------------------------
check("MG73-M", "no archetype penalises action_density or action_intensity",
  profile.dna_baseline.archetypes.every(a => !a.penalise
    || (!("action_density" in a.penalise) && !("action_intensity" in a.penalise))),
  profile.dna_baseline.archetypes.filter(a => a.penalise && ("action_density" in a.penalise || "action_intensity" in a.penalise)).map(a => a.id).join(", "));
check("MG73-M2", "and every action archetype requires REAL Sci-Fi substance, never density alone",
  profile.dna_baseline.archetypes
    .filter(a => a.requires.some(r => r.dimension === "action_density"))
    .every(a => a.requires.length >= 2
      && a.requires.some(r => ["scientific_investigation", "rule_discovery", "concept_escalation", "mystery"].includes(r.dimension))));

// -- P, Q: things that must not have moved ------------------------------------
check("MG73-P", "action_density is still barred from feedback projection", (() => {
  const text = fs.readFileSync("DAILY_AUTOMATION_PROMPT.md", "utf8");
  const fence = text.split(String.fromCharCode(96, 96, 96)).filter((_, i) => i % 2 === 1)[0] || "";
  return fence.includes("horror, action_density, action_intensity")
    && !/CONTENT-PROJECTABLE dimensions are exactly:[^.]*action_density/.test(fence);
})());
check("MG73-Q", "horror policy is untouched: weight -6, contextual, never hard-excluded",
  profile.dna_baseline.weights.horror === -6
  && profile.dna_guardrails.combination.some(c => c.id === "horror_without_science_or_mystery" && c.penalty === -30)
  && !profile.dna_guardrails.hard_exclusion.some(h => h.dimension === "horror"));

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
