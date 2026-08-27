// F2-6 validation test matrix, cases A .. Z plus the additional cases agreed
// at the design gate. Run with: node test/validate-profile.test.mjs
//
// Cases W, X, Y and Z exercise the frozen combination-guardrail boolean
// semantics rather than the validator, because those are evaluation rules a
// consumer must honour and they need to be pinned down before F2-8 reads them.

import fs from "node:fs";
import { validateProfile, validateItemDna, CANONICAL_DIMENSIONS, CANONICAL_DNA_TAGS } from "../scripts/validate-profile.mjs";

const SCHEMA3 = JSON.parse(fs.readFileSync("data/taste-profile.json", "utf8"));

let passed = 0;
let failed = 0;

function check(id, description, condition, detail) {
  if (condition) { passed++; console.log(`  ok   ${id}  ${description}`); }
  else { failed++; console.error(`  FAIL ${id}  ${description}${detail ? `\n         ${detail}` : ""}`); }
}

const clone = v => JSON.parse(JSON.stringify(v));

// Build the schema-2 profile the repository had before F2-6: identical, minus
// the four DNA sections, with schema_version back at 2.
function schema2Profile() {
  const p = clone(SCHEMA3);
  p.schema_version = 2;
  delete p.dna_dimensions;
  delete p.dna_baseline;
  delete p.dna_guardrails;
  delete p.execution_preferences;
  return p;
}

// A profile mutated by fn, expected to produce at least one error mentioning `needle`.
function expectError(id, description, fn, needle) {
  const p = clone(SCHEMA3);
  fn(p);
  const errs = validateProfile(p);
  const hit = needle ? errs.some(e => e.includes(needle)) : errs.length > 0;
  check(id, description, errs.length > 0 && hit, errs.length === 0 ? "expected an error, got none" : `errors: ${errs.join(" | ")}`);
}

function expectClean(id, description, profile) {
  const errs = validateProfile(profile);
  check(id, description, errs.length === 0, errs.join(" | "));
}

console.log("F2-6 validation matrix");
console.log("");

// --- A: the pre-F2-6 schema-2 profile still validates ----------------------
expectClean("A ", "schema-2 profile (pre-F2-6 shape) validates", schema2Profile());

// --- A2: schema 2 may not carry any DNA configuration section --------------
for (const section of ["dna_dimensions", "dna_baseline", "dna_guardrails", "execution_preferences"]) {
  const p = schema2Profile();
  p[section] = clone(SCHEMA3[section]);
  const errs = validateProfile(p);
  check("A2", `schema 2 + ${section} is rejected`,
    errs.some(e => e.includes(`schema_version 2 must not contain ${section}`)), errs.join(" | "));
}

// --- B: the committed schema-3 profile validates ---------------------------
expectClean("B ", "committed schema-3 profile validates", clone(SCHEMA3));

// --- C: 26 dimensions ------------------------------------------------------
expectError("C ", "26 dimensions is rejected", p => { p.dna_dimensions.dimensions.pop(); }, "is missing dimension");

// --- D: duplicate dimension id --------------------------------------------
expectError("D ", "duplicate dimension id is rejected", p => {
  p.dna_dimensions.dimensions[1] = clone(p.dna_dimensions.dimensions[0]);
}, "duplicate dimension");

// --- E: an unknown 28th dimension -----------------------------------------
expectError("E ", "a 28th dimension is rejected", p => {
  p.dna_dimensions.dimensions.push({ id: "extra_dimension", label: "Extra", direction: "absent_to_dominant", rubric: { "0": "a", "5": "b", "10": "c" } });
  p.dna_dimensions.count = 28;
}, "unknown dimension 'extra_dimension'");

// --- F: world_rules_equivalent must never return ---------------------------
expectError("F ", "world_rules_equivalent is rejected", p => {
  p.dna_dimensions.dimensions[8].id = "world_rules_equivalent";
}, "unknown dimension 'world_rules_equivalent'");

// --- G: archetype references an unknown dimension --------------------------
expectError("G ", "archetype referencing an unknown dimension is rejected", p => {
  p.dna_baseline.archetypes[0].emphasis.not_a_dimension = 5;
}, "references unknown dimension 'not_a_dimension'");

// --- H: guardrail references an unknown dimension --------------------------
expectError("H ", "guardrail referencing an unknown dimension is rejected", p => {
  p.dna_guardrails.combination[0].all_of[0].dimension = "not_a_dimension";
}, "references unknown dimension 'not_a_dimension'");

// --- I: rubric problems ----------------------------------------------------
expectError("I1", "rubric anchor outside 0/3/5/8/10 is rejected", p => {
  p.dna_dimensions.dimensions[0].rubric["7"] = "seven";
}, "unknown key '7'");
expectError("I2", "non-string rubric value is rejected", p => {
  p.dna_dimensions.dimensions[0].rubric["5"] = 5;
}, "must be a non-empty string");
expectError("I3", 'missing required rubric anchor "5" is rejected', p => {
  delete p.dna_dimensions.dimensions[0].rubric["5"];
}, 'missing required anchor "5"');

// --- J: number typing and ranges -------------------------------------------
expectError("J1", "string weight is rejected", p => { p.dna_baseline.weights.mystery = "20"; }, "must be an integer -40..40");
expectError("J2", "NaN weight is rejected", p => { p.dna_baseline.weights.mystery = NaN; }, "must be an integer -40..40");
expectError("J3", "Infinity weight is rejected", p => { p.dna_baseline.weights.mystery = Infinity; }, "must be an integer -40..40");
expectError("J4", "out-of-range weight (41) is rejected", p => { p.dna_baseline.weights.mystery = 41; }, "must be an integer -40..40");
expectError("J5", "float where an integer is required is rejected", p => { p.dna_baseline.weights.mystery = 14.5; }, "must be an integer -40..40");
expectError("J6", "positive penalty is rejected", p => { p.dna_guardrails.combination[0].penalty = 35; }, "must be an integer -100..-1");
expectError("J7", "out-of-range archetype weight is rejected", p => { p.dna_baseline.archetypes[0].weight = 2.5; }, "must be a number 0.1..2.0");
expectError("J8", "emphasis value 0 is rejected", p => { p.dna_baseline.archetypes[0].emphasis.mystery = 0; }, "must be an integer 1..10");
expectError("J9", "threshold above 10 is rejected", p => { p.dna_guardrails.hard_exclusion[0].at_or_above = 11; }, "must be an integer 0..10");

// --- K: pace_speed is the only slow_to_fast dimension ----------------------
expectError("K1", "pace_speed marked absent_to_dominant is rejected", p => {
  p.dna_dimensions.dimensions.find(d => d.id === "pace_speed").direction = "absent_to_dominant";
}, "exactly one dimension may be slow_to_fast");
expectError("K2", "a second slow_to_fast dimension is rejected", p => {
  p.dna_dimensions.dimensions.find(d => d.id === "suspense").direction = "slow_to_fast";
}, "exactly one dimension may be slow_to_fast");

// --- L: the existing library controlled-tag path still fails as before -----
{
  const p = clone(SCHEMA3);
  p.controlled_tags = [];
  const errs = validateProfile(p);
  check("L1", "empty controlled_tags is rejected", errs.some(e => e.includes("controlled_tags must be a non-empty array")), errs.join(" | "));
}
{
  // The item-level unknown-tag check lives in validate.mjs and is unchanged by
  // F2-6; assert the profile-level guard that feeds it is intact.
  const p = clone(SCHEMA3);
  check("L2", "controlled_tags is untouched by F2-6 (15 legacy tags)", p.controlled_tags.length === 15, `got ${p.controlled_tags.length}`);
}

// --- M: unsupported schema version ----------------------------------------
for (const bad of [4, 1, 0, -1]) {
  const p = clone(SCHEMA3);
  p.schema_version = bad;
  const errs = validateProfile(p);
  check("M ", `schema_version ${bad} is rejected`, errs.some(e => e.includes("unsupported schema_version")), errs.join(" | "));
}
{
  const p = clone(SCHEMA3);
  p.schema_version = "3";
  const errs = validateProfile(p);
  check("M ", "schema_version as a string is rejected", errs.some(e => e.includes("must be an integer")), errs.join(" | "));
}

// --- N: proved separately by the build-hash comparison ---------------------
console.log("  --   N   build-site output equality is proved by test/inertness.test.mjs");

// --- O: item-level DNA validation ------------------------------------------
{
  const DIMS = new Set(SCHEMA3.dna_dimensions.dimensions.map(d => d.id));
  const TAGS = new Set(SCHEMA3.dna_dimensions.tag_registry);
  const itemErrs = item => validateItemDna(item, DIMS, TAGS);

  check("O1", "an item with no DNA block is legal (enrichment is incremental)",
    itemErrs({ title: "x", type: "movie", year: 2020 }).length === 0);
  check("O2", "a well-formed DNA block is accepted",
    itemErrs({ dna: { mystery: 8, superhero: 0, pace_speed: null }, dna_confidence: 0.75, dna_tags: ["glacier", "research_station"] }).length === 0);
  check("O3", "unknown dna_tag 'research_staton' is rejected",
    itemErrs({ dna_tags: ["research_staton"] }).some(e => e.includes("unknown tag 'research_staton'")));
  check("O4", "duplicate dna_tag is rejected",
    itemErrs({ dna_tags: ["glacier", "glacier"] }).some(e => e.includes("duplicate tag 'glacier'")));
  check("O5", "unknown dna dimension is rejected",
    itemErrs({ dna: { world_rules_equivalent: 5 } }).some(e => e.includes("unknown dimension 'world_rules_equivalent'")));
  check("O6", "dna value 11 is rejected",
    itemErrs({ dna: { mystery: 11 } }).some(e => e.includes("integer 0..10 or null")));
  check("O7", "dna value as a string is rejected",
    itemErrs({ dna: { mystery: "8" } }).some(e => e.includes("integer 0..10 or null")));
  check("O8", "dna null is accepted as UNKNOWN", itemErrs({ dna: { mystery: null } }).length === 0);
  check("O9", "dna_confidence above 1.0 is rejected",
    itemErrs({ dna_confidence: 1.5 }).some(e => e.includes("0.0..1.0")));
  check("O10", "DNA fields with no declared registry are rejected",
    validateItemDna({ dna_tags: ["glacier"] }, new Set(), new Set()).some(e => e.includes("declares no dna_dimensions registry")));
}

// --- P: duplicate tag in the registry --------------------------------------
expectError("P ", "duplicate tag in tag_registry is rejected", p => {
  p.dna_dimensions.tag_registry[1] = p.dna_dimensions.tag_registry[0];
}, "duplicate tag");

// --- Q: malformed tag in the registry --------------------------------------
expectError("Q ", "malformed tag in tag_registry is rejected", p => {
  p.dna_dimensions.tag_registry[0] = "Research Station";
}, "tag_registry");

// --- R: a guardrail dimension missing from required_known_dimensions -------
for (const dim of ["superhero", "comic_book_universe", "pace_speed", "creature_threat", "action_intensity"]) {
  const p = clone(SCHEMA3);
  p.dna_baseline.completeness_defaults.required_known_dimensions =
    p.dna_baseline.completeness_defaults.required_known_dimensions.filter(d => d !== dim);
  const errs = validateProfile(p);
  check("R ", `dropping guardrail dimension '${dim}' from required_known_dimensions is rejected`,
    errs.some(e => e.includes(`is missing '${dim}', which dna_guardrails references`)), errs.join(" | "));
}

// --- S: required_known_dimensions with an unknown id -----------------------
expectError("S ", "unknown id in required_known_dimensions is rejected", p => {
  p.dna_baseline.completeness_defaults.required_known_dimensions.push("not_a_dimension");
}, "required_known_dimensions references unknown dimension 'not_a_dimension'");

// --- T: requires_mode is mandatory, with no default ------------------------
expectError("T1", "archetype missing requires_mode is rejected", p => {
  delete p.dna_baseline.archetypes[0].requires_mode;
}, "requires_mode is required");
expectError("T2", "archetype with an invalid requires_mode is rejected", p => {
  p.dna_baseline.archetypes[0].requires_mode = "ALL";
}, "requires_mode is required");

// --- U: a condition carrying both thresholds -------------------------------
expectError("U ", "condition with both at_or_above and at_or_below is rejected", p => {
  p.dna_guardrails.combination[0].all_of[0].at_or_above = 5;
}, "not both");

// --- V: a condition carrying neither threshold -----------------------------
expectError("V ", "condition with neither threshold is rejected", p => {
  delete p.dna_guardrails.combination[0].all_of[0].at_or_below;
}, "must carry exactly one of at_or_above / at_or_below");

// ---------------------------------------------------------------------------
// W .. Z: the frozen combination-guardrail boolean semantics.
//
//   fires  <=>  all_of.every(true) AND (any_of.length === 0 OR any_of.some(true))
//   a condition whose dimension is unknown/null evaluates FALSE, both ways.
// ---------------------------------------------------------------------------
function evalCondition(condition, dna) {
  const v = dna?.[condition.dimension];
  if (!Number.isInteger(v) || v < 0 || v > 10) return false;   // unknown => false
  if (Object.prototype.hasOwnProperty.call(condition, "at_or_above")) return v >= condition.at_or_above;
  return v <= condition.at_or_below;
}

function fires(rule, dna) {
  const allOk = rule.all_of.every(c => evalCondition(c, dna));
  const anyOk = rule.any_of.length === 0 || rule.any_of.some(c => evalCondition(c, dna));
  return allOk && anyOk;
}

const byId = id => SCHEMA3.dna_guardrails.combination.find(r => r.id === id);
const creatureChase = byId("creature_chase_without_investigation");   // any_of is empty
const actionFirst = byId("action_first_without_investigation");       // any_of has 3 conditions

// W: all_of true, any_of empty -> fires
check("W ", "all_of true + empty any_of fires", fires(creatureChase, {
  creature_threat: 8, survival_chase: 7, scientific_investigation: 2, rule_discovery: 1
}));

// X: all_of true, non-empty any_of all false -> does not fire
check("X ", "all_of true + non-empty any_of all false does not fire", !fires(actionFirst, {
  scientific_investigation: 2, space_opera: 0, military_focus: 0, action_intensity: 0
}));

// Y: all_of true, one any_of true -> fires
check("Y ", "all_of true + one any_of true fires", fires(actionFirst, {
  scientific_investigation: 2, space_opera: 0, military_focus: 7, action_intensity: 0
}));

// Z: a null dimension makes its condition false, in both directions
check("Z1", "null in an at_or_above condition does not fire", !fires(actionFirst, {
  scientific_investigation: 2, space_opera: null, military_focus: null, action_intensity: null
}));
check("Z2", "null in an at_or_below condition does not fire", !fires(creatureChase, {
  creature_threat: 8, survival_chase: 7, scientific_investigation: null, rule_discovery: 1
}));
check("Z3", "a missing dimension key does not fire", !fires(creatureChase, {
  creature_threat: 8, survival_chase: 7, rule_discovery: 1
}));
// and a high creature_threat on its own is NOT penalised
check("Z4", "creature_threat 10 alone does not fire the creature-chase rule", !fires(creatureChase, {
  creature_threat: 10, survival_chase: 2, scientific_investigation: 8, rule_discovery: 7
}));

// ---------------------------------------------------------------------------
// Additional cases agreed at the design gate
// ---------------------------------------------------------------------------

// AA: strict recursive unknown-key handling, one probe per validated object
const AA_PROBES = [
  ["dna_dimensions", p => p.dna_dimensions],
  ["dna_dimensions.scale", p => p.dna_dimensions.scale],
  ["dna_dimensions.principles", p => p.dna_dimensions.principles],
  ["dna_dimensions.dimensions[0]", p => p.dna_dimensions.dimensions[0]],
  ["dna_dimensions.dimensions[0].rubric", p => p.dna_dimensions.dimensions[0].rubric],
  ["dna_baseline", p => p.dna_baseline],
  ["dna_baseline.completeness_defaults", p => p.dna_baseline.completeness_defaults],
  ["dna_baseline.archetypes[0]", p => p.dna_baseline.archetypes[0]],
  ["dna_baseline.archetypes[0].requires[0]", p => p.dna_baseline.archetypes[0].requires[0]],
  ["dna_guardrails", p => p.dna_guardrails],
  ["dna_guardrails.hard_exclusion[0]", p => p.dna_guardrails.hard_exclusion[0]],
  ["dna_guardrails.combination[0]", p => p.dna_guardrails.combination[0]],
  ["dna_guardrails.combination[0].all_of[0]", p => p.dna_guardrails.combination[0].all_of[0]],
  ["dna_guardrails.not_expressible_in_dna", p => p.dna_guardrails.not_expressible_in_dna],
  ["dna_guardrails.not_expressible_in_dna.entries[0]", p => p.dna_guardrails.not_expressible_in_dna.entries[0]],
  ["execution_preferences", p => p.execution_preferences],
  ["execution_preferences.content_vs_execution", p => p.execution_preferences.content_vs_execution],
  ["execution_preferences.evidence_ladder", p => p.execution_preferences.evidence_ladder]
];
for (const [label, pick] of AA_PROBES) {
  const p = clone(SCHEMA3);
  pick(p).surprise_key = "x";
  const errs = validateProfile(p);
  check("AA", `unknown key in ${label} is rejected`, errs.some(e => e.includes("unknown key 'surprise_key'")), errs.join(" | "));
}
// a mis-typed dimension id inside weights is caught as an unknown reference
expectError("AA", "typo 'scientfic_investigation' in weights is rejected", p => {
  p.dna_baseline.weights.scientfic_investigation = p.dna_baseline.weights.scientific_investigation;
  delete p.dna_baseline.weights.scientific_investigation;
}, "unknown dimension 'scientfic_investigation'");

// AB: weights + unweighted must cover the registry exactly and stay disjoint
expectError("AB1", "a dimension in neither weights nor unweighted is rejected", p => {
  delete p.dna_baseline.weights.isolation;
}, "is in neither dna_baseline.weights nor dna_baseline.unweighted");
expectError("AB2", "a dimension in both weights and unweighted is rejected", p => {
  p.dna_baseline.unweighted.push("mystery");
}, "appears in both");

// AC: content_vs_execution must sum to 1.0
expectError("AC", "content_vs_execution summing to 0.9 is rejected", p => {
  p.execution_preferences.content_vs_execution.execution_fit = 0.2;
}, "must sum to 1.0");

// AD: a hard_exclusion may not carry a penalty
expectError("AD", "hard_exclusion carrying a penalty is rejected", p => {
  p.dna_guardrails.hard_exclusion[0].penalty = -50;
}, "must not carry a penalty");

// AE: schema 3 requires all four sections
for (const section of ["dna_dimensions", "dna_baseline", "dna_guardrails", "execution_preferences"]) {
  const p = clone(SCHEMA3);
  delete p[section];
  const errs = validateProfile(p);
  check("AE", `schema 3 missing ${section} is rejected`, errs.some(e => e.includes(`schema_version 3 requires ${section}`)), errs.join(" | "));
}

// AH: the evidence ladder must be strictly increasing
expectError("AH", "non-increasing evidence_ladder is rejected", p => {
  p.execution_preferences.evidence_ladder.emerging = 1;
}, "strictly increasing");

// ---------------------------------------------------------------------------
// AF / AG: DNA score-eligibility, and the unknown-is-not-safe property.
// ---------------------------------------------------------------------------
const CD = SCHEMA3.dna_baseline.completeness_defaults;

function eligible(item) {
  const dna = item.dna || {};
  const known = id => Number.isInteger(dna[id]) && dna[id] >= 0 && dna[id] <= 10;
  const knownCount = CANONICAL_DIMENSIONS.filter(known).length;
  const confidence = typeof item.dna_confidence === "number" && Number.isFinite(item.dna_confidence) ? item.dna_confidence : 0;
  const requiredOk = CD.required_known_dimensions.every(known);
  return knownCount >= CD.min_known_dimensions && confidence >= CD.min_confidence && requiredOk;
}

function hardExcluded(item) {
  if (!eligible(item)) return false;              // ineligible items are never DNA-excluded
  return SCHEMA3.dna_guardrails.hard_exclusion.some(r => evalCondition({ dimension: r.dimension, at_or_above: r.at_or_above }, item.dna));
}

// a fully-enriched item, then variations on it
function enriched(overrides = {}) {
  const dna = {};
  for (const id of CANONICAL_DIMENSIONS) dna[id] = 5;
  return { dna: { ...dna, ...overrides }, dna_confidence: 0.8 };
}

check("AF1", "item with superhero=null is NOT DNA-score-eligible", !eligible(enriched({ superhero: null })));
check("AF2", "item with superhero=null is NOT hard-excluded either", !hardExcluded(enriched({ superhero: null })));
check("AF3", "item below min_confidence is NOT eligible", !eligible({ ...enriched(), dna_confidence: 0.5 }));
check("AF4", "item below min_known_dimensions is NOT eligible", (() => {
  const item = enriched();
  // strip down to 17 known dimensions, keeping every required one known
  const optional = CANONICAL_DIMENSIONS.filter(d => !CD.required_known_dimensions.includes(d));
  for (const id of optional.slice(0, optional.length - 2)) item.dna[id] = null;
  return !eligible(item);
})());
check("AG1", "fully enriched item IS eligible", eligible(enriched()));
check("AG2", "eligible item with superhero=8 IS hard-excluded", hardExcluded(enriched({ superhero: 8 })));
check("AG3", "eligible item with superhero=6 is NOT hard-excluded", !hardExcluded(enriched({ superhero: 6 })));
check("AG4", "eligible item with comic_book_universe=7 IS hard-excluded", hardExcluded(enriched({ comic_book_universe: 7 })));

// ---------------------------------------------------------------------------
// Registry invariants
// ---------------------------------------------------------------------------
check("REG", "profile declares exactly 27 dimensions", SCHEMA3.dna_dimensions.dimensions.length === 27, `got ${SCHEMA3.dna_dimensions.dimensions.length}`);
check("REG", "profile count field is 27", SCHEMA3.dna_dimensions.count === 27);
check("REG", "profile declares exactly 20 DNA tags", SCHEMA3.dna_dimensions.tag_registry.length === 20, `got ${SCHEMA3.dna_dimensions.tag_registry.length}`);
check("REG", "canonical dimension list is 27", CANONICAL_DIMENSIONS.length === 27);
check("REG", "canonical DNA tag list is 20", CANONICAL_DNA_TAGS.length === 20);
check("REG", "creature_threat and survival_chase are both present and distinct",
  CANONICAL_DIMENSIONS.includes("creature_threat") && CANONICAL_DIMENSIONS.includes("survival_chase"));
check("REG", "world_rules_equivalent is absent from the registry", !CANONICAL_DIMENSIONS.includes("world_rules_equivalent"));
check("REG", "isolation carries baseline weight 0", SCHEMA3.dna_baseline.weights.isolation === 0);
check("REG", "creature_threat carries baseline weight 0 (no standalone penalty)", SCHEMA3.dna_baseline.weights.creature_threat === 0);
check("REG", "hard_exclusions is unchanged (2 named franchises)",
  SCHEMA3.hard_exclusions.length === 2 && SCHEMA3.hard_exclusions[0] === "Star Wars franchise" && SCHEMA3.hard_exclusions[1] === "Star Trek franchise");
check("REG", "required_known_dimensions covers every guardrail-referenced dimension", (() => {
  const referenced = new Set();
  for (const r of SCHEMA3.dna_guardrails.hard_exclusion) referenced.add(r.dimension);
  for (const r of SCHEMA3.dna_guardrails.combination) {
    for (const c of [...r.all_of, ...r.any_of]) referenced.add(c.dimension);
  }
  const required = new Set(CD.required_known_dimensions);
  return [...referenced].every(d => required.has(d)) && referenced.size === required.size;
})(), `required=${CD.required_known_dimensions.length}`);
check("REG", "superhero rubric 10 does not mention comic-book structure",
  !SCHEMA3.dna_dimensions.dimensions.find(d => d.id === "superhero").rubric["10"].includes("comic"));
check("REG", "military_focus rubric 10 does not mention action",
  !SCHEMA3.dna_dimensions.dimensions.find(d => d.id === "military_focus").rubric["10"].includes("action"));
check("REG", "pace_speed rubric 5 reads 'moderate / steady'",
  SCHEMA3.dna_dimensions.dimensions.find(d => d.id === "pace_speed").rubric["5"] === "moderate / steady");

console.log("");
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
