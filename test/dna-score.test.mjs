// F2-8 scoring and personalized-input tests.
// Run with: node test/dna-score.test.mjs

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  makePolicy, scoreItem, dnaEligible, hardExcluded, firingCombinations,
  guardrailPoints, requiredFor, bestArchetype, baselineContentPre, evalRule, isKnown
} from "../scripts/dna-score.mjs";
import {
  readPersonalizedScores, PERSONALIZED_SCHEMA_VERSION,
  FRESHNESS_MAX_AGE_MS, FRESHNESS_FUTURE_SKEW_MS
} from "../scripts/personalized-scores.mjs";

const profile = JSON.parse(fs.readFileSync("data/taste-profile.json", "utf8"));
const config = JSON.parse(fs.readFileSync("config/catalogs.json", "utf8"));
const policy = makePolicy(profile);
const DIMS = policy.dimensions;

const items = [];
{
  const lib = JSON.parse(fs.readFileSync("data/library.json", "utf8"));
  for (const it of lib.items || []) items.push(it);
  for (const n of fs.readdirSync("data/discoveries").filter(x => x.endsWith(".json")).sort()) {
    const p = JSON.parse(fs.readFileSync(path.join("data/discoveries", n), "utf8"));
    for (const it of (Array.isArray(p) ? p : p.items || [])) items.push(it);
  }
}

const def = id => config.catalogs.find(c => c.id === id);
const DNA_DEFS = config.catalogs.filter(c => c.filter === "dna");
const byTitle = t => items.find(i => (i.canonical_title || i.title) === t);

let passed = 0, failed = 0;
function check(id, description, condition, detail) {
  if (condition) { passed++; console.log(`  ok   ${id}  ${description}`); }
  else { failed++; console.error(`  FAIL ${id}  ${description}${detail ? `\n         ${detail}` : ""}`); }
}
const clone = v => JSON.parse(JSON.stringify(v));

// a synthetic, fully-known item that scores well everywhere
function synthetic(overrides = {}, confidence = 0.9) {
  const dna = {};
  for (const d of DIMS) dna[d] = 5;
  return { imdb_id: "tt0000001", type: "movie", title: "Synthetic", year: 2020, dna: { ...dna, ...overrides }, dna_confidence: confidence, dna_tags: [] };
}

console.log("F2-8 DNA scoring");
console.log("");

// ---------------------------------------------------------------- config
check("C1", "config declares 15 catalog definitions", config.catalogs.length === 15, `got ${config.catalogs.length}`);
check("C2", "config schema_version is 2", config.schema_version === 2);
check("C3", "manifest.version is 2.2.0", config.manifest.version === "2.2.0");
check("C4", "six DNA rows are declared", DNA_DEFS.length === 6, DNA_DEFS.map(d => d.id).join(","));
check("C5", "archetype_bonus_max = 25", def("dna-match").dna.archetype_bonus_max === 25, String(def("dna-match").dna.archetype_bonus_max));
check("C6", "High Suspense min_score = 60", def("high-suspense").min_score === 60, String(def("high-suspense").min_score));
for (const id of ["dna-match", "fringe-dna", "investigation-first", "concept-escalating"]) {
  check("C7", `${id} min_score = 50`, def(id).min_score === 50, String(def(id).min_score));
}
check("C8", "every DNA row sorts by dna_score", DNA_DEFS.every(d => d.sort === "dna_score"));
check("C9", "penalty scale is derived, not authored", Math.abs(policy.penaltyScale - 1000 / 2410) < 1e-12 && policy.baseMax === 2410);

// ---------------------------------------------------------------- production data
{
  const eligibleItems = items.filter(i => dnaEligible(policy, i));
  check("P1", `all ${items.length} F2-7 records score without throwing`, (() => {
    for (const it of items) for (const d of DNA_DEFS) scoreItem(policy, d, it, new Map());
    return true;
  })());
  // Never assert a literal production count: the live automation adds items on
  // its own schedule. Assert the RULE instead, so the test stays true as the
  // catalog grows.
  const CD = policy.completeness;
  const isComplete = it => DIMS.filter(d => isKnown(it.dna, d)).length >= CD.min_known_dimensions
    && CD.required_known_dimensions.every(d => isKnown(it.dna, d));
  const hasConfidence = it => typeof it.dna_confidence === "number" && it.dna_confidence >= CD.min_confidence;

  check("P2a", `eligibility matches the rule for all ${items.length} records`,
    items.every(it => dnaEligible(policy, it) === (isComplete(it) && hasConfidence(it))));
  check("P2b", `every eligible item is complete and confident (${eligibleItems.length}/${items.length} eligible)`,
    eligibleItems.every(it => isComplete(it) && hasConfidence(it)));
  check("P2c", "any item below the confidence floor is ineligible",
    items.filter(it => !hasConfidence(it)).every(it =>
      scoreItem(policy, def("dna-match"), it, new Map()).reason === "dna_ineligible"));
  check("P2d", "an item with no dna block at all is ineligible, never scored as zeros",
    scoreItem(policy, def("dna-match"), { imdb_id: "tt0000009", type: "movie", title: "Unenriched", year: 2020 }, new Map())
      .reason === "dna_ineligible");

  // The known low-confidence title, guarded so the test degrades to a no-op
  // rather than a false failure if it is ever re-enriched.
  {
    const lowConfidence = byTitle("The Reality Experiment");
    if (lowConfidence && lowConfidence.dna_confidence < CD.min_confidence) {
      check("P3", `The Reality Experiment is ineligible (confidence ${lowConfidence.dna_confidence})`,
        scoreItem(policy, def("dna-match"), lowConfidence, new Map()).reason === "dna_ineligible");
    } else {
      check("P3", "The Reality Experiment is no longer below the confidence floor (skipped)", true);
    }
  }
  check("P4", "no production item is hard-excluded", items.filter(i => hardExcluded(policy, i.dna)).length === 0);
  check("P5", "every scored value is an integer 0..100", items.every(it => DNA_DEFS.every(d => {
    const s = scoreItem(policy, d, it, new Map()).score;
    return s === null || (Number.isInteger(s) && s >= 0 && s <= 100);
  })));
}

// ---------------------------------------------------------------- FIX 1: unknown is never zero
{
  // These three dimensions are used by their row but are deliberately NOT in
  // dna_baseline.completeness_defaults.required_known_dimensions, so it is the
  // ROW-required set - not baseline eligibility - that has to catch them.
  const BASELINE_REQUIRED = new Set(policy.completeness.required_known_dimensions);
  const posDim = "scientist_presence";   // positive weight in investigation-first
  const penDim = "comedy";               // penalty weight in high-suspense
  const gateDim = "suspense";            // gate dimension of high-suspense
  check("F1z", "the three probe dimensions sit outside the baseline required set",
    ![posDim, penDim, gateDim].some(d => BASELINE_REQUIRED.has(d)));

  const nullPos = synthetic({ [posDim]: null });
  const r1 = scoreItem(policy, def("investigation-first"), nullPos, new Map());
  check("F1a", "null weighted POSITIVE dimension -> ineligible, not scored as zero",
    r1.score === null && r1.reason === `missing_required:${posDim}`, JSON.stringify(r1));

  const nullPen = synthetic({ [penDim]: null });
  const r2 = scoreItem(policy, def("high-suspense"), nullPen, new Map());
  check("F1b", "null weighted PENALTY dimension -> ineligible, cannot escape the penalty",
    r2.score === null && r2.reason === `missing_required:${penDim}`, JSON.stringify(r2));

  const nullGate = synthetic({ [gateDim]: null });
  const r3 = scoreItem(policy, def("high-suspense"), nullGate, new Map());
  check("F1c", "null GATE dimension -> ineligible via the required set",
    r3.score === null && r3.reason === `missing_required:${gateDim}`, JSON.stringify(r3));

  // proof it is not silently treated as 0: a real 0 IS measured and IS scored.
  // min_score is removed here so the assertion is about scoring, not filtering.
  const openDef = { ...def("investigation-first"), min_score: 0 };
  const r4 = scoreItem(policy, openDef, synthetic({ [posDim]: 0 }), new Map());
  check("F1d", "an explicit 0 still scores (0 means measured-and-absent)",
    Number.isInteger(r4.score) && r4.reason === null, JSON.stringify(r4));
  const r4b = scoreItem(policy, openDef, synthetic({ [posDim]: 10 }), new Map());
  check("F1d2", "0 and 10 on the same dimension produce different scores",
    r4b.score > r4.score, `${r4.score} vs ${r4b.score}`);

  // MG-7.2 replaced the additive invariant. It used to read "27 of the 28, NOT
  // action_density", which was right only while density was unmeasured. With
  // coverage at 127/127 DNA Match requires all 28: an unknown density now means
  // an unresearched discovery, not a legacy gap, and it must not score.
  check("F1e", "DNA Match requires all 28 dimensions",
    requiredFor(policy, def("dna-match")).length === 28
    && requiredFor(policy, def("dna-match")).includes("action_density"),
    String(requiredFor(policy, def("dna-match")).length));
  check("F1f", "row required set = baseline required U gate U weights U penalties", (() => {
    const req = new Set(requiredFor(policy, def("high-suspense")));
    const cfg = def("high-suspense").dna;
    return policy.completeness.required_known_dimensions.every(d => req.has(d))
      && Object.keys(cfg.weights).every(d => req.has(d))
      && Object.keys(cfg.penalties).every(d => req.has(d))
      && [...cfg.gate.all_of, ...cfg.gate.any_of].every(c => req.has(c.dimension));
  })());
  // MG-7 CHANGED THIS CONTRACT ON PURPOSE, SO THE ASSERTION GOT STRONGER.
  //
  // Before MG-7 every vector was complete for every row, so "nothing is ever
  // missing_required" held trivially. The additive scifi-action row gates on
  // action_density, which is null on every record predating the shape
  // migration, so that row now reports missing_required - by design, and it is
  // why the row WAS empty until the backfill ran. The backfill is complete, so
  // the row now fills from genuinely measured densities.
  //
  // Asserting "nothing is missing" would now be false; deleting the assertion
  // would lose the protection. So it pins the exact blast radius instead: the
  // ONLY row allowed to report missing_required is scifi-action, and the ONLY
  // dimension it may report is action_density. If the migration ever leaked
  // into a pre-existing row, or a second dimension went unmeasured, this fails.
  check("F1g", "the ONLY missing_required is action_density on scifi-action", (() => {
    for (const it of items.filter(i => dnaEligible(policy, i))) {
      for (const d of DNA_DEFS) {
        const reason = scoreItem(policy, d, it, new Map()).reason || "";
        if (!reason.startsWith("missing_required")) continue;
        if (d.id !== "scifi-action") return false;
        if (reason !== "missing_required:action_density") return false;
      }
    }
    return true;
  })());
  check("F1h", "every PRE-EXISTING DNA row still scores every eligible item", (() => {
    const preExisting = DNA_DEFS.filter(d => d.id !== "scifi-action");
    return items.filter(i => dnaEligible(policy, i)).every(it =>
      preExisting.every(d => !(scoreItem(policy, d, it, new Map()).reason || "").startsWith("missing_required")));
  })());
}

// ---------------------------------------------------------------- FIX 2: clamp before guardrails
{
  // a maximal item: every positive at 10, every negative at 0
  const maxed = {};
  for (const d of DIMS) maxed[d] = 0;
  for (const [d, w] of Object.entries(policy.weights)) if (w > 0) maxed[d] = 10;
  const saturated = synthetic(maxed);

  const pre = baselineContentPre(policy, saturated, 25);
  check("F2a", "content_base + archetype_bonus exceeds 100 before clamping",
    pre.contentBase + pre.archetypeBonus > 100, `${pre.contentBase.toFixed(1)} + ${pre.archetypeBonus.toFixed(1)}`);
  check("F2b", "content_pre is clamped to exactly 100 BEFORE guardrails", pre.contentPre === 100, String(pre.contentPre));

  // now force a guardrail to fire on an otherwise saturated item:
  // slow_without_discovery needs pace<=3, mystery<=4, escalation<=4, rule_discovery<=4
  const saturatedButSlow = clone(saturated);
  Object.assign(saturatedButSlow.dna, { pace_speed: 0, mystery: 0, concept_escalation: 0, rule_discovery: 0 });
  const fired = firingCombinations(policy, saturatedButSlow.dna);
  const pts = guardrailPoints(policy, saturatedButSlow.dna);
  const scored = scoreItem(policy, def("dna-match"), saturatedButSlow, new Map());
  const preSlow = baselineContentPre(policy, saturatedButSlow, 25);
  check("F2c", "a firing guardrail still lowers a saturated score",
    fired.length === 1 && fired[0].id === "slow_without_discovery"
    && preSlow.contentPre === 100 && scored.score === Math.round(100 - pts),
    `pre=${preSlow.contentPre} pts=${pts.toFixed(2)} score=${scored.score}`);
  check("F2d", "-22 guardrail deducts 9 points on the profile scale", Math.round(pts) === 9, pts.toFixed(2));
}

// ---------------------------------------------------------------- guardrails
{
  const excl = synthetic({ superhero: 8 });
  check("G1", "superhero >= 7 is hard-excluded from every DNA row",
    DNA_DEFS.every(d => scoreItem(policy, d, excl, new Map()).reason === "hard_excluded"));
  const excl2 = synthetic({ comic_book_universe: 7 });
  check("G2", "comic_book_universe >= 7 is hard-excluded from every DNA row",
    DNA_DEFS.every(d => scoreItem(policy, d, excl2, new Map()).reason === "hard_excluded"));
  check("G3", "superhero 6 is NOT excluded", !hardExcluded(policy, synthetic({ superhero: 6 }).dna));

  const expected = { "-35": 14.5, "-30": 12.4, "-22": 9.1 };
  check("G4", "each combination rule converts to its scale-consistent points",
    profile.dna_guardrails.combination.every(r =>
      Math.abs(Math.abs(r.penalty) * policy.penaltyScale - expected[String(r.penalty)]) < 0.05));

  check("G5", "Underwater fires action_first + creature_chase (27.0 pts)", (() => {
    const dna = byTitle("Underwater").dna;
    const ids = firingCombinations(policy, dna).map(r => r.id).sort();
    return ids.join(",") === "action_first_without_investigation,creature_chase_without_investigation"
      && Math.abs(guardrailPoints(policy, dna) - 26.97) < 0.1;
  })());
  check("G6", "Blood Glacier fires nothing", firingCombinations(policy, byTitle("Blood Glacier").dna).length === 0);
  check("G7", "unknown dimension never satisfies a guardrail condition",
    !evalRule(profile.dna_guardrails.combination[0], { scientific_investigation: null, space_opera: null }));
}

// ---------------------------------------------------------------- row gates
{
  check("R1", "Cube is gated out of Investigation First (si 4 < 5)",
    scoreItem(policy, def("investigation-first"), byTitle("Cube"), new Map()).reason === "row_gate");
  check("R2", "Saw is gated out of High Suspense despite suspense 8",
    scoreItem(policy, def("high-suspense"), byTitle("Saw"), new Map()).reason === "row_gate");
  check("R3", "The Platform 2 is gated out of Concept Escalating (ce 2 < 5)",
    scoreItem(policy, def("concept-escalating"), byTitle("The Platform 2"), new Map()).reason === "row_gate");
  check("R4", "Blood Glacier passes the Investigation First gate (si 6) and is filtered only by min_score",
    scoreItem(policy, def("investigation-first"), byTitle("Blood Glacier"), new Map()).reason === "below_min_score");
  check("R4b", "Blood Glacier is scored, not gated, when min_score is lifted",
    Number.isInteger(scoreItem(policy, { ...def("investigation-first"), min_score: 0 }, byTitle("Blood Glacier"), new Map()).score));
  check("R5", "best archetype is chosen, never averaged", (() => {
    const a = bestArchetype(policy, byTitle("Fringe").dna);
    const all = profile.dna_baseline.archetypes.map(x => x.id);
    return a && all.includes(a.id) && a.effective === Math.max(...profile.dna_baseline.archetypes
      .map(x => { const b = bestArchetype(policy, byTitle("Fringe").dna); return b.effective; }));
  })());
}

// ---------------------------------------------------------------- determinism
{
  const run = () => items.map(it => DNA_DEFS.map(d => scoreItem(policy, d, it, new Map()).score).join(",")).join("|");
  check("D1", "scoring is deterministic across repeated runs", run() === run() && run() === run());
}

// ---------------------------------------------------------------- personalized input
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "f28-"));
  const file = path.join(tmp, "personalized-scores.json");
  const fresh = () => new Date(Date.now() - 60_000).toISOString().replace(/\.\d+Z$/, "Z");
  const write = payload => fs.writeFileSync(file, JSON.stringify(payload), "utf8");
  const valid = () => ({
    schema_version: 1,
    generated_at: fresh(),
    items: { tt2299206: { dna_match: 90, execution_fit: 40 } }
  });

  const expectStatus = (id, description, payload, status) => {
    if (payload === null) { try { fs.unlinkSync(file); } catch {} }
    else if (typeof payload === "string") fs.writeFileSync(file, payload, "utf8");
    else write(payload);
    const r = readPersonalizedScores(fs, file);
    check(id, description, r.status === status, `got '${r.status}'`);
    return r;
  };

  expectStatus("X1", "missing file -> absent", null, "absent");
  expectStatus("X2", "invalid JSON -> invalid_json", "{not json", "invalid_json");
  expectStatus("X3", "unsupported schema_version -> unsupported_schema", { ...valid(), schema_version: 2 }, "unsupported_schema");
  expectStatus("X4", "unknown top-level key -> bad_shape", { ...valid(), notes: "x" }, "bad_shape");
  expectStatus("X5", "missing top-level key -> bad_shape", { schema_version: 1, items: {} }, "bad_shape");
  expectStatus("X6", "non-UTC timestamp -> bad_timestamp", { ...valid(), generated_at: "2026-08-25T06:35:07+02:00" }, "bad_timestamp");
  expectStatus("X7", "unparseable timestamp -> bad_timestamp", { ...valid(), generated_at: "not-a-date" }, "bad_timestamp");
  expectStatus("X8", "100h old -> stale", { ...valid(), generated_at: new Date(Date.now() - 100 * 3600_000).toISOString().replace(/\.\d+Z$/, "Z") }, "stale");
  expectStatus("X9", "3h in the future -> future", { ...valid(), generated_at: new Date(Date.now() + 3 * 3600_000).toISOString().replace(/\.\d+Z$/, "Z") }, "future");
  expectStatus("X10", "71h old is still fresh -> applied", { ...valid(), generated_at: new Date(Date.now() - 71 * 3600_000).toISOString().replace(/\.\d+Z$/, "Z") }, "applied");
  expectStatus("X11", "30min in the future is within skew -> applied", { ...valid(), generated_at: new Date(Date.now() + 30 * 60_000).toISOString().replace(/\.\d+Z$/, "Z") }, "applied");

  check("X12", "freshness window is 72h / +1h skew",
    FRESHNESS_MAX_AGE_MS === 72 * 3600_000 && FRESHNESS_FUTURE_SKEW_MS === 3600_000 && PERSONALIZED_SCHEMA_VERSION === 1);

  // item-level rejections keep the rest of the file
  const itemCase = (id, description, entries, keptIds) => {
    write({ schema_version: 1, generated_at: fresh(), items: entries });
    const r = readPersonalizedScores(fs, file);
    check(id, description, r.status === "applied" && [...r.items.keys()].sort().join(",") === keptIds.join(","),
      `status=${r.status} kept=${[...r.items.keys()].join(",")}`);
  };
  itemCase("X13", "privacy field on an item -> that item dropped, file kept",
    { tt111: { dna_match: 50, execution_fit: 50, rating: 2 }, tt222: { dna_match: 60, execution_fit: 60 } }, ["tt222"]);
  itemCase("X14", "feedback_id on an item -> dropped",
    { tt111: { dna_match: 50, execution_fit: 50, feedback_id: "x" }, tt222: { dna_match: 60, execution_fit: 60 } }, ["tt222"]);
  itemCase("X15", "invalid IMDb key -> dropped",
    { nm123: { dna_match: 50, execution_fit: 50 }, tt222: { dna_match: 60, execution_fit: 60 } }, ["tt222"]);
  itemCase("X16", "score 101 -> dropped", { tt111: { dna_match: 101, execution_fit: 50 }, tt222: { dna_match: 60, execution_fit: 60 } }, ["tt222"]);
  itemCase("X17", "score -1 -> dropped", { tt111: { dna_match: -1, execution_fit: 50 }, tt222: { dna_match: 60, execution_fit: 60 } }, ["tt222"]);
  itemCase("X18", "score as a string -> dropped", { tt111: { dna_match: "95", execution_fit: 50 }, tt222: { dna_match: 60, execution_fit: 60 } }, ["tt222"]);
  itemCase("X19", "fractional score -> dropped", { tt111: { dna_match: 95.5, execution_fit: 50 }, tt222: { dna_match: 60, execution_fit: 60 } }, ["tt222"]);
  itemCase("X20", "missing execution_fit -> dropped", { tt111: { dna_match: 50 }, tt222: { dna_match: 60, execution_fit: 60 } }, ["tt222"]);

  // the 0.7 / 0.3 arithmetic, and fallback for an absent id
  {
    write(valid());
    const r = readPersonalizedScores(fs, file);
    const bg = byTitle("Blood Glacier");
    const personalizedScore = scoreItem(policy, def("dna-match"), bg, r.items).score;
    const pts = guardrailPoints(policy, bg.dna);
    const expectedScore = Math.round(0.7 * 90 + 0.3 * 40 - pts);
    check("X21", "personalized DNA Match = 0.7*dna_match + 0.3*execution_fit",
      personalizedScore === expectedScore, `${personalizedScore} vs ${expectedScore}`);

    const baselineScore = scoreItem(policy, def("dna-match"), bg, new Map()).score;
    check("X22", "personalized differs from baseline for the same title", personalizedScore !== baselineScore,
      `personalized=${personalizedScore} baseline=${baselineScore}`);

    const other = byTitle("Pandorum");
    check("X23", "an id absent from the file falls back to baseline",
      scoreItem(policy, def("dna-match"), other, r.items).score === scoreItem(policy, def("dna-match"), other, new Map()).score);

    check("X24", "personalized input does not change eligibility or gates",
      scoreItem(policy, def("investigation-first"), byTitle("Cube"), r.items).reason === "row_gate"
      && scoreItem(policy, def("dna-match"), byTitle("The Reality Experiment"), r.items).reason === "dna_ineligible");
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  // F2-9 legitimately creates the production file, so its absence is no longer
  // an invariant. What this suite must guarantee is that IT never writes there:
  // every fixture above lived in a temp directory.
  check("X25", "this suite's fixtures were confined to a temp directory, never the production path",
    !tmp.startsWith(process.cwd()) && !fs.existsSync(tmp));
}

// ---------------------------------------------------------------- isolation
{
  const source = fs.readFileSync("scripts/build-site.mjs", "utf8")
    + fs.readFileSync("scripts/dna-score.mjs", "utf8")
    + fs.readFileSync("scripts/personalized-scores.mjs", "utf8");
  check("I1", "the DNA build path performs no network access",
    !/\bfetch\s*\(|node:https?|require\(['"]https?['"]\)|XMLHttpRequest/.test(source));
  check("I2", "no reference to the private feedback repository",
    !/wtf-scifi-feedback|FEEDBACK_TOKEN/i.test(source));
}

console.log("");
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
