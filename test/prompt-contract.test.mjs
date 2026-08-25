// Freezes the contract of the LIVE canonical automation prompt.
//
// DAILY_AUTOMATION_PROMPT.md is production code: the scheduled task fetches it
// fresh on every run and executes the fenced block verbatim. A commit to that
// file is a deployment, with no staging step in between. These assertions are
// the only gate between an edit and the next live run.
//
// Two properties matter most:
//   the prompt must CARRY policy - what to generate, what to dedupe, what to
//   publish - and must READ every canonical value (registry, weights,
//   archetypes, thresholds, row scoring) live from the repository, so the
//   prompt can never drift out of sync with taste-profile.json.
//
// Run with: node test/prompt-contract.test.mjs

import fs from "node:fs";

const PROMPT = "DAILY_AUTOMATION_PROMPT.md";
const text = fs.readFileSync(PROMPT, "utf8");
const profile = JSON.parse(fs.readFileSync("data/taste-profile.json", "utf8"));
const config = JSON.parse(fs.readFileSync("config/catalogs.json", "utf8"));

let passed = 0, failed = 0;
const check = (id, description, condition, detail) => {
  if (condition) { passed++; console.log(`  ok   ${id}  ${description}`); }
  else { failed++; console.error(`  FAIL ${id}  ${description}${detail ? `\n         ${detail}` : ""}`); }
};

console.log("Canonical automation prompt contract");
console.log("");

// ---------------------------------------------------------------- the fence
const blocks = text.split("```");
const fenced = blocks.filter(b => b.startsWith("text") && b.includes("Read BOTH GitHub repositories"));
check("F1", "exactly one canonical fenced block exists", fenced.length === 1, `found ${fenced.length}`);
const fence = fenced[0] || "";
check("F2", "the fenced block is non-trivial", fence.length > 5000, `${fence.length} chars`);

const has = needle => fence.includes(needle);
const hasAll = (...needles) => needles.every(has);

// ---------------------------------------------------------------- F2-9: discovery DNA
check("D1", "requires dna, dna_confidence and dna_tags on accepted discoveries",
  hasAll("CONTENT DNA IS REQUIRED ON EVERY ACCEPTED DISCOVERY", "dna_confidence", "dna_tags"));
check("D2", "states that 0 is assessed-absent and null is genuinely unknown",
  has("0 means assessed and absent or minimal") && has("null means genuinely unknown"));
check("D3", "forbids null as an effort shortcut and forbids inflating confidence",
  has("Never use null to avoid research effort") && has("Never inflate it so a title clears a DNA eligibility threshold"));
check("D4", "states DNA is descriptive, not a prediction of enjoyment",
  has('Content DNA answers "what kind of title is this", never "will the user like it"'));
check("D5", "forbids bending the fingerprint from feedback about similar titles",
  has("Do not raise a dimension because the user liked a similar title"));
check("D6", "confines dna_tags to the closed registry",
  has("only values from dna_dimensions.tag_registry") && has("Never invent a tag"));

// ---------------------------------------------------------------- F2-9: duplicates
check("P1", "builds the complete public identity set before accepting",
  has("BUILD THE COMPLETE PUBLIC IDENTITY SET BEFORE ACCEPTING ANYTHING"));
check("P2", "defines identity as IMDb id, else normalized title + year + type",
  has("IMDb id when there is a usable one, and otherwise the normalized title plus year plus media type"));
check("P3", "a known identity counts as duplicate and never as accepted",
  has("counts toward the run's duplicates count and NEVER toward accepted"));
check("P4", "a duplicate gets no replacement DNA fingerprint",
  has("MUST NOT be given a replacement Content DNA fingerprint"));
check("P5", "re-checks identities immediately before the final write",
  has("Immediately before the final write, rebuild the identity set"));

// ---------------------------------------------------------------- F2-9: personalized output
check("S1", "regenerates personalized-scores.json on every successful run",
  has("REGENERATE data/personalized-scores.json ON EVERY SUCCESSFUL RUN"));
check("S2", "regenerates even on a zero-findings run",
  has("INCLUDING runs that accept zero new discoveries"));
check("S3", "declares the closed schema and both integer score fields",
  hasAll('"schema_version": 1', "dna_match", "execution_fit", "No other top-level key and no other per-item key may appear"));
check("S4", "generated_at is the public generation time, never a private timestamp",
  has("never a timestamp copied from a private feedback event"));
check("S5", "only current watch titles may be keys",
  has('titles whose CURRENT public status is "watch"') && has("a seen title is never an output key"));
check("S6", "an empty items object is valid", has("An empty items object is valid output"));
check("S7", "omission is preferred over invented precision",
  has("Never publish a baseline value disguised as a personalized one"));

// every forbidden private field is named as forbidden
const FORBIDDEN = ["rating", "premise_interest", "more_like_this", "liked", "disliked", "dnf_reasons",
  "feedback", "feedback_id", "supersedes", "source_id", "rated_at", "received_at"];
const banSection = fence.slice(fence.indexOf("The following must NEVER appear in this file"),
  fence.indexOf("The file carries two derived integers per title and nothing else."));
check("S8", "names every forbidden private field in the ban list",
  FORBIDDEN.every(f => banSection.includes(f)),
  FORBIDDEN.filter(f => !banSection.includes(f)).join(", "));

// ---------------------------------------------------------------- F2-9: derivations
check("M1", "dna_match excludes the public guardrails to avoid double-penalising",
  has("BEFORE the public DNA guardrails") && has("subtracting them here would penalise the title twice"));
check("M2", "uses the BEST matching archetype, never an average",
  has("BEST matching archetype") && has("never an average across archetypes"));
check("M3", "ratings, DNF reasons and execution aspects contribute nothing to dna_match",
  has("Ratings, did-not-finish reasons and execution aspects contribute NOTHING here"));
check("M4", "lists the 17 content-projectable dimensions", (() => {
  const PROJECTABLE = ["scientific_investigation", "biology_genetics", "alien_unknown_life", "unknown_phenomenon",
    "mystery", "rule_discovery", "concept_escalation", "weirdness", "reality_anomaly", "time_anomaly",
    "mind_consciousness", "experiments", "conspiracy", "scientist_presence", "research_setting",
    "isolation", "creature_threat"];
  const line = fence.slice(fence.indexOf("The CONTENT-PROJECTABLE dimensions are exactly:"));
  return PROJECTABLE.every(d => line.slice(0, 600).includes(d));
})());
check("M5", "forbids projecting content preference into tone/structural dimensions",
  has("Never project content preference into suspense, horror, action_intensity, survival_chase, military_focus, comedy, pace_speed, space_opera, superhero or comic_book_universe"));
check("M6", "explains why that projection is forbidden",
  has('must never teach "I like action"'));
check("M7", "premise_interest is +/-1.00 and schema-1 more_like_this is +/-0.50",
  has("premise_interest yes/no: +/-1.00") && has("more_like_this yes/no: +/-0.50"));
check("M8", "uses source DNA >= 7 for premise projection", has("SOURCE title's DNA is >= 7"));
check("M9", "freezes the concept-aspect mapping", hasAll(
  "mystery -> mystery", "science_biology -> biology_genetics",
  "alien_unknown -> alien_unknown_life, unknown_phenomenon",
  "reality_time_anomaly -> reality_anomaly, time_anomaly",
  "creature_threat -> creature_threat", "premise_concept -> the generic projection"));
check("M10", "multi-dimension mappings require source >= 5",
  has("apply only those mapped dimensions the SOURCE title actually scores >= 5"));
check("M11", "clamps one title to +/-1 per dimension",
  has("Clamp each single title's total contribution to any one dimension to +/-1"));
check("M12", "baseline weight 0 stays learnable via the importance floor",
  has('Baseline weight 0 means "neutral by default", not "feedback may never teach a preference here"')
  && has("creature_threat and isolation remain learnable"));
check("M13", "restricts the importance floor to content-projectable dimensions",
  has("Do not apply this floor outside the content-projectable set"));

check("E1", "execution_fit never becomes a content aversion",
  has("must never turn an execution complaint into a content aversion")
  && has("must never lower that title's biology or science content fit"));
check("E2", "k is 0 unless public evidence is reliable, and is never forced",
  has("0 when ordinary, ambiguous, conflicting or insufficiently documented") && has("Do not force +1 or -1"));
check("E3", "tone maps losslessly into execution_fit, not into content",
  has("TONE aspects contribute NOTHING to dna_match")
  && has("survival_chase -> survival_chase") && has("action -> action_intensity"));
check("E4", "invents no DNA equivalent for setting_atmosphere or emotion",
  has("setting_atmosphere and emotion have no exact DNA equivalent and must not be given an invented one"));
check("E5", "omits the title when exec_norm is 0",
  has("If exec_norm is 0 the title has no defensible title-specific execution or tone estimate and MUST BE OMITTED"));

check("B1", "states the 6 / 12 / 20 evidence bounds",
  has("at most 6 points, two titles by at most 12") && has("three or more consistent independent titles unlock the full 20"));
check("B2", "one extreme rating cannot reshape the catalog",
  has("One 1-star or 5-star rating must never reshape the catalog"));
check("B3", "retracted and unsupported tips contribute zero",
  has("Retracted chains contribute zero") && has("opaque and contributes zero learning"));
check("B4", "lists all six sufficiency conditions", (() => {
  const section = fence.slice(fence.indexOf("WHICH TITLES GET AN ENTRY"));
  return ["1.", "2.", "3.", "4.", "5.", "6."].every(n => section.slice(0, 1400).includes(n));
})());
check("B5", "checks sufficiency before doing the arithmetic",
  has("Check sufficiency FIRST, and only then do the arithmetic"));

// ---------------------------------------------------------------- F2-9: transactional
check("T1", "prepares all public changes before committing",
  has("PREPARE EVERYTHING, THEN COMMIT ONCE") && has("The run is transactional"));
check("T2", "fails the run before any commit if the personalized file is bad",
  has("FAIL THE RUN BEFORE ANY PUBLIC COMMIT"));
check("T3", "never commits a discovery without the personalized refresh",
  has("Do not commit a discovery file or a log record without the required personalized refresh"));
check("T4", "leaves the previous personalized file untouched on failure",
  has("the previous personalized-scores.json remains in place untouched"));
check("T5", "a zero-findings run may still commit the refresh",
  has("A zero-findings run remains valid"));

// ---------------------------------------------------------------- reads, never restates
check("R1", "instructs the run to read the canonical policy files",
  hasAll("data/taste-profile.json", "config/catalogs.json", "scripts/dna-score.mjs"));
check("R2", "reads the registry rather than restating it",
  has("Never restate the registry from memory") && has("dna_dimensions.dimensions"));
check("R3", "reads weights, archetypes and completeness live",
  hasAll("dna_baseline.weights", "dna_baseline.archetypes", "dna_baseline.completeness_defaults",
    "dna_guardrails.hard_exclusion"));
check("R4", "explicitly forbids restating scoring constants from memory",
  has("Do not restate any weight, archetype or bonus constant from memory"));

// no canonical constant is duplicated into the prompt
// The feedback aspect vocabulary and the archetype ids collide on one name:
// reality_time_anomaly is a CONCEPT ASPECT the frozen mapping must name, and
// coincidentally also an archetype id. Its presence is legitimate policy, so it
// is excluded by name rather than by weakening the check.
const CONCEPT_ASPECT_IDS = new Set([
  "mystery", "science_biology", "alien_unknown", "scientific_investigation", "world_rules",
  "concept_escalation", "weirdness", "reality_time_anomaly", "mind_consciousness",
  "experiments", "conspiracy", "creature_threat", "premise_concept"
]);
check("C1", "contains no archetype id from taste-profile.json (aspect-name collisions excluded)", (() => {
  const leaked = profile.dna_baseline.archetypes
    .filter(a => !CONCEPT_ASPECT_IDS.has(a.id) && fence.includes(a.id));
  return leaked.length === 0;
})(), profile.dna_baseline.archetypes
  .filter(a => !CONCEPT_ASPECT_IDS.has(a.id) && fence.includes(a.id)).map(a => a.id).join(", "));
check("C1b", "the only archetype-name collision is the aspect id reality_time_anomaly",
  profile.dna_baseline.archetypes.filter(a => fence.includes(a.id)).every(a => a.id === "reality_time_anomaly"));
check("C2", "does not restate archetype_bonus_max", !fence.includes("archetype_bonus_max"));
check("C3", "does not restate any row min_score value", (() => {
  const dnaRows = config.catalogs.filter(c => c.filter === "dna");
  return !dnaRows.some(r => fence.includes(`min_score ${r.min_score}`) || fence.includes(`min_score: ${r.min_score}`));
})());
check("C4", "does not restate the completeness thresholds", (() => {
  const cd = profile.dna_baseline.completeness_defaults;
  return !fence.includes(`min_known_dimensions ${cd.min_known_dimensions}`)
    && !fence.includes(`min_confidence ${cd.min_confidence}`);
})());
check("C5", "does not copy the dna_tags registry into the prompt", (() => {
  const present = profile.dna_dimensions.tag_registry.filter(t => fence.includes(`"${t}"`));
  return present.length === 0;
})(), profile.dna_dimensions.tag_registry.filter(t => fence.includes(`"${t}"`)).join(", "));
check("C6", "does not restate a rubric anchor", (() => {
  const anchors = profile.dna_dimensions.dimensions.map(d => d.rubric["10"]);
  return !anchors.some(a => fence.includes(a));
})());
check("C7", "does not restate any dna_baseline weight value", (() => {
  return !Object.entries(profile.dna_baseline.weights)
    .some(([d, w]) => fence.includes(`${d}: ${w}`) || fence.includes(`${d} = ${w}`) || fence.includes(`"${d}": ${w}`));
})());

// ---------------------------------------------------------------- F2-5 must survive
check("L1", "F2-5 feedback resolution is intact", hasAll(
  "RESOLVE FEEDBACK EVENT HISTORY BEFORE USING IT FOR TASTE LEARNING",
  "FEEDBACK EVENTS CARRY A SCHEMA VERSION. HONOUR IT",
  "EVIDENCE WEIGHTING", "CORE GUARDRAILS ARE STRUCTURAL"));
check("L2", "unsupported schemas still may not resurrect an older opinion",
  has("Discarding it would let an older, already-superseded opinion become active again"));
check("L3", "existing operational limits survive", hasAll(
  "minimum_match_score", "daily_movie_max", "daily_series_max", "Zero findings is valid"));
// After the duplicate-integrity repair the builder no longer merges or silently
// deduplicates colliding identities - it fails closed. The prompt must not tell
// the automation otherwise, or it will keep writing duplicates believing the
// builder will tidy them up.
check("L3b", "does not claim the builder deduplicates duplicate identities",
  !fence.includes("deduplicates them") && !/builder[^.]*deduplicat/i.test(fence));
check("L3c", "states that the builder fails closed on a repeated public identity",
  has("FAILS CLOSED if the same public identity appears more than once")
  && has("The automation must prevent duplicates before writing them"));
check("L3d", "still keeps the append-only discovery instruction intact",
  has("create one append-only file in the PUBLIC catalog repository at data/discoveries/<run_id>.json")
  && has("Do not create duplicate Past 24h entries"));

check("L4", "the private repository stays read-only",
  has("Do not modify the PRIVATE feedback repository at any point"));
check("L5", "private free text is never published",
  has("without quoting private feedback verbatim") && has("Do not include private feedback text in the user-facing run report"));

console.log("");
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
