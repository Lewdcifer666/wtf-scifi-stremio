// Freezes the DIRECT-TONE applicability rule that the first live F2-9 run got
// wrong.
//
// That run published items:{} for 104 watch titles. It had read condition 6's
// "applicable title-specific EXECUTION or DIRECT-TONE link" as requiring the
// LLM judgement k(X,a) for EVERY term. Since the prompt tells it to set k = 0
// whenever evidence is ordinary or ambiguous, exec_norm was 0 everywhere and
// every title was omitted. Direct tone is not a judgement - it is deterministic
// arithmetic on the candidate's own measured DNA.
//
// exec_norm is computed by the automation, not by repository code, so there is
// nothing in scripts/ to unit-test. This file therefore holds a REFERENCE
// IMPLEMENTATION of the frozen rule, exercises it against the five agreed
// fixtures, and asserts that the canonical prompt still states that same rule.
// If either side drifts, one of these fails.
//
// Run with: node test/direct-tone.test.mjs

import fs from "node:fs";

let passed = 0, failed = 0;
const check = (id, description, condition, detail) => {
  if (condition) { passed++; console.log(`  ok   ${id}  ${description}`); }
  else { failed++; console.error(`  FAIL ${id}  ${description}${detail ? `\n         ${detail}` : ""}`); }
};

console.log("F2-9 direct-tone applicability");
console.log("");

// ---------------------------------------------------------------- reference implementation
const EXECUTION_ASPECTS = ["acting", "characters", "dialogue", "pacing", "visuals",
  "effects", "ending_payoff", "sound_music", "originality"];
const TONE_TO_DIM = { suspense: "suspense", horror: "horror", action: "action_intensity",
  humor: "comedy", survival_chase: "survival_chase", military_focus: "military_focus" };

// An EXECUTION aspect is applicable only with a usable public-knowledge judgement.
const executionApplicable = (Pe, k, aspect) => (Pe[aspect] ?? 0) !== 0 && (k[aspect] ?? 0) !== 0;

// A TONE dimension is applicable on measured DNA alone. No k. No threshold.
const toneApplicable = (Pt, dna, dim) =>
  (Pt[dim] ?? 0) !== 0 && Number.isInteger(dna[dim]) && dna[dim] !== 0;

function execParts(Pe, Pt, k, dna) {
  let raw = 0, norm = 0;
  for (const a of EXECUTION_ASPECTS) {
    if (!executionApplicable(Pe, k, a)) continue;
    raw += Pe[a] * k[a];
    norm += Math.abs(Pe[a]);
  }
  for (const dim of Object.values(TONE_TO_DIM)) {
    if (!toneApplicable(Pt, dna, dim)) continue;
    raw += Pt[dim] * (dna[dim] / 10);
    norm += Math.abs(Pt[dim]);
  }
  return { raw, norm };
}
const passesCondition6 = (Pe, Pt, k, dna) => execParts(Pe, Pt, k, dna).norm > 0;

// A candidate whose mapped tone dimensions are all measured 0 unless overridden.
const candidate = over => ({ suspense: 0, horror: 0, action_intensity: 0, comedy: 0,
  survival_chase: 0, military_focus: 0, ...over });

const NO_K = {};                       // no usable execution judgement anywhere
const Pt_SUSPENSE = { suspense: 0.3 };
const Pe_ACTING = { acting: -0.3 };

// ---------------------------------------------------------------- A
{
  const { norm } = execParts({}, Pt_SUSPENSE, NO_K, candidate({ suspense: 1 }));
  check("A", "Pt(suspense) != 0, candidate suspense = 1, no usable k -> exec_norm > 0, passes condition 6",
    norm > 0 && passesCondition6({}, Pt_SUSPENSE, NO_K, candidate({ suspense: 1 })), `norm=${norm}`);
}
// the whole point: 1 and 4 are applicable, there is no >=5 or >=7 gate
for (const v of [1, 2, 3, 4, 5, 6, 7, 9, 10]) {
  check("A+", `candidate suspense = ${v} is applicable (no >=5 or >=7 gate)`,
    passesCondition6({}, Pt_SUSPENSE, NO_K, candidate({ suspense: v })));
}

// ---------------------------------------------------------------- B
{
  const dna = candidate({ suspense: 0 });     // every other mapped tone dim is 0 too
  const { norm } = execParts({}, Pt_SUSPENSE, NO_K, dna);
  check("B", "candidate suspense = 0 and all other mapped tone dims 0, no k -> exec_norm stays 0",
    norm === 0 && !passesCondition6({}, Pt_SUSPENSE, NO_K, dna), `norm=${norm}`);
}

// ---------------------------------------------------------------- C
{
  const dna = candidate({ suspense: null });
  check("C", "candidate suspense = null -> the tone dimension is not applicable",
    !toneApplicable(Pt_SUSPENSE, dna, "suspense")
    && execParts({}, Pt_SUSPENSE, NO_K, dna).norm === 0);
  check("C2", "an unknown dimension is not treated as 0 and not treated as applicable",
    !toneApplicable(Pt_SUSPENSE, candidate({ suspense: undefined }), "suspense"));
}

// ---------------------------------------------------------------- D
{
  const dna = candidate({ suspense: 4 });
  const parts = execParts(Pe_ACTING, Pt_SUSPENSE, { acting: 0 }, dna);
  check("D", "execution k = 0 but valid direct tone exists -> candidate is NOT omitted",
    parts.norm > 0 && passesCondition6(Pe_ACTING, Pt_SUSPENSE, { acting: 0 }, dna), `norm=${parts.norm}`);
  check("D2", "the zero-k execution aspect contributes nothing to exec_norm",
    Math.abs(parts.norm - Math.abs(Pt_SUSPENSE.suspense)) < 1e-9, `norm=${parts.norm}`);
}

// ---------------------------------------------------------------- E
{
  const dna = candidate();                    // every mapped tone dimension measured 0
  const parts = execParts(Pe_ACTING, Pt_SUSPENSE, { acting: -1 }, dna);
  check("E", "valid execution k with all direct tones absent -> execution alone satisfies exec_norm > 0",
    parts.norm > 0 && passesCondition6(Pe_ACTING, Pt_SUSPENSE, { acting: -1 }, dna), `norm=${parts.norm}`);
  check("E2", "with neither a usable k nor an applicable tone, the title is omitted",
    !passesCondition6(Pe_ACTING, Pt_SUSPENSE, { acting: 0 }, dna));
}

// ---------------------------------------------------------------- the H1 regression itself
{
  // Reproduce the live failure: real learned tone, every candidate measured on
  // it, no usable k. Under the correct rule every one of these qualifies.
  const dnaSet = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(v => candidate({ suspense: v, survival_chase: 10 - v }));
  const Pt = { suspense: 0.3, survival_chase: -0.3 };
  const qualifying = dnaSet.filter(d => passesCondition6({}, Pt, NO_K, d)).length;
  check("H1", `the H1 reading cannot return: ${qualifying}/${dnaSet.length} candidates qualify on tone alone`,
    qualifying === dnaSet.length);
}

// ---------------------------------------------------------------- prompt states the same rule
{
  const text = fs.readFileSync("DAILY_AUTOMATION_PROMPT.md", "utf8");
  const fence = text.split("```").find(b => b.startsWith("text") && b.includes("Read BOTH GitHub repositories")) || "";
  const has = n => fence.includes(n);

  check("P1", "condition 6 is defined through exec_norm > 0",
    has("6. exec_norm must be greater than 0 for this title"));
  check("P2", "tone applicability is stated as Pt != 0 AND known AND non-zero",
    has("A mapped tone dimension t is APPLICABLE to candidate X if and only if all three hold: Pt(t) is not 0, X.dna[t] is known, and X.dna[t] is not 0"));
  check("P3", "the prompt denies any >=5 or >=7 threshold for direct tone",
    has("there is NO >=5 gate and NO >=7 gate for direct tone"));
  check("P4", "the prompt states direct tone is deterministic",
    has("Direct tone is DETERMINISTIC, computed from the candidate's own measured DNA"));
  check("P5", "the prompt forbids requiring k for a tone dimension",
    has("DO NOT require k(X,a) for a tone dimension"));
  check("P6", "the prompt scopes k to execution-category aspects only",
    has("k(X,a) applies ONLY to execution-category aspects"));
  check("P7", "the prompt says a candidate may qualify on direct tone alone",
    has("A candidate with no usable execution judgement can still qualify on direct tone alone, and must not be omitted for lacking k"));
  check("P8", "exec_norm is self-defining in the prompt",
    has("exec_norm = sum of |Pe(a)| over execution aspects where Pe(a) != 0 AND k(X, a) != 0")
    && has("sum of |Pt(t)| over tone dimensions where Pt(t) != 0 AND X.dna[t] is known AND X.dna[t] != 0"));
  check("P9", "the vague pre-fix wording is gone",
    !has("The candidate's applicability is its own measured DNA on that dimension")
    && !has("at least one applicable title-specific EXECUTION or DIRECT-TONE link exists"));
  check("P10", "the discovery-log append instruction discourages reserializing old runs",
    has("do not reserialize or reformat old runs merely to append the new record"));
}

console.log("");
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
