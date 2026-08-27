// The Sci-Fi feedback OWNERSHIP filter (MG-7).
//
// The private feedback repository is SHARED across every WTF addon, and a
// feedback event carries no profile context - nothing in it says which addon
// surfaced the title. Once Fantasy, Action, Anime and Thriller go live, an
// unfiltered Sci-Fi run would consume a rating the user gave an anime and bend
// this profile toward taste never expressed about science fiction. The
// direct-tone path makes that concrete: horror -> horror and action ->
// action_intensity would happily absorb a Jujutsu Kaisen rating.
//
// This addon's runtime is a PROMPT, so its contract is asserted the same way the
// rest of the daily contract is - against the canonical fenced block that the
// scheduled task fetches fresh and executes verbatim.
//
// The load-bearing property is ORDERING. Ownership must be the LAST step, after
// the supersedes graph is fully resolved. Filtering earlier would let a
// superseded or retracted opinion become active again, which is exactly the
// failure the resolution rules already exist to prevent.
//
// Run with: node test/feedback-ownership.test.mjs

import fs from "node:fs";

let passed = 0, failed = 0;
const check = (id, description, condition, detail) => {
  if (condition) { passed++; console.log("  ok   " + id + "  " + description); }
  else { failed++; console.error("  FAIL " + id + "  " + description + (detail ? "\n         " + detail : "")); }
};

const PROMPT = "DAILY_AUTOMATION_PROMPT.md";
const text = fs.readFileSync(PROMPT, "utf8");
const blocks = text.split("```").filter((_, i) => i % 2 === 1);
const fenced = blocks.filter(b => b.startsWith("text") && b.includes("Read BOTH GitHub repositories"));
const fence = fenced[0] || "";

const has = needle => fence.includes(needle);
const hasAll = (...needles) => needles.every(has);
const norm = fence.replace(/\s+/g, " ");
const hasLoose = needle => norm.includes(needle.replace(/\s+/g, " "));

console.log("Feedback ownership");
console.log("");

check("O0", "the canonical fenced block was found", fence.length > 5000, String(fence.length));

// -- the rule is present and unambiguous -------------------------------------
check("OA1", "the fence states this addon learns only from its own titles",
  has("FEEDBACK OWNERSHIP. THIS ADDON LEARNS ONLY FROM ITS OWN TITLES."));

check("OA2", "ownership requires a non-null imdb_id AND membership of THIS repo's identity set",
  hasLoose("it has a valid, non-null imdb_id, AND")
  && hasLoose("that imdb_id is already present in THIS repository's own current public")
  && hasLoose("identity set: data/library.json plus every data/discoveries/*.json."));

// -- A: an owned event contributes -------------------------------------------
check("OA3", "an OWNED event is usable - the rule is a filter, not a blanket ban",
  hasLoose("may contribute to Sci-Fi taste learning or")
  && hasLoose("ONLY when BOTH hold"));

// -- B and C: non-owned events contribute exactly zero ------------------------
check("OB1", "a non-owned event contributes EXACTLY ZERO to every learning path",
  hasLoose("it contributes EXACTLY ZERO to all of")
  && hasAll("content preference learning", "tone preference learning",
            "execution-fit learning", "personalized score generation",
            "Sci-Fi recommendation weighting"));

check("OB2", "zero is spelled out so it cannot be read as a reduced weight",
  hasLoose("Zero means zero. Not a reduced weight, not weak context, not a tie-breaker."));

check("OC1", "the shared-repository reason names the other addons explicitly",
  has("Fantasy, Action,") && has("Anime, Thriller") && hasLoose("a feedback event carries NO profile context"));

// -- D: ownership is evaluated AFTER supersedes topology ----------------------
check("OD1", "the fence fixes the order and puts ownership last",
  hasLoose("THE ORDER IS NOT NEGOTIABLE. Ownership is the LAST step, applied only to already")
  && hasLoose("ONLY THEN apply the ownership filter below, for taste learning."));

check("OD2", "the numbered order resolves the graph globally BEFORE ownership", (() => {
  const global = norm.indexOf("Resolve the supersedes graph GLOBALLY.");
  const tips = norm.indexOf("Determine the effective current chain tips GLOBALLY.");
  const own = norm.indexOf("ONLY THEN apply the ownership filter");
  return global > 0 && tips > global && own > tips;
})(), "supersedes resolution must precede the ownership step in the written order");

check("OD3", "topology-first is stated as a named principle",
  hasLoose("TOPOLOGY FIRST, OWNERSHIP SECOND. Ownership must never influence which event is")
  && hasLoose("the chain tip."));

// -- E: a non-owned newest tip must not resurrect an older owned opinion -------
check("OE1", "a non-owned tip must NOT resurrect an older Sci-Fi-looking parent",
  hasLoose("Do NOT resurrect an older, Sci-Fi-looking parent because the newer chain tip")
  && hasLoose("is not owned."));

check("OE2", "and the consequence is spelled out: no usable opinion, not a fallback",
  hasLoose("that title simply has no usable")
  && hasLoose("Sci-Fi opinion. An earlier event in the same chain is still superseded and")
  && hasLoose("still contributes nothing."));

check("OE3", "a non-owned event is not deleted and stays in the topology",
  hasLoose("Do NOT delete it, and do NOT treat it as absent.")
  && hasLoose("Do NOT remove it from the supersedes topology. It still supersedes what it")
  && hasLoose("supersedes."));

// -- F: unsupported schemas still control topology ----------------------------
check("OF1", "unsupported-schema handling is preserved and kept independent",
  hasLoose("UNSUPPORTED SCHEMAS ARE A SEPARATE MATTER")
  && hasLoose("the existing OPAQUE semantics")
  && hasLoose("Ownership is an additional, independent filter, not a replacement for that rule."));

check("OF2", "both combinations are disambiguated",
  hasLoose("An unsupported tip that IS owned is still opaque. A supported tip that is NOT")
  && hasLoose("owned is still unusable here."));

check("OF3", "the pre-existing rule that an unsupported event stays in the graph survives",
  has("An unsupported event must NOT be discarded before chain resolution."));

// -- G: a null imdb_id contributes zero ---------------------------------------
check("OG1", "a null imdb_id contributes zero, for a stated reason",
  hasLoose("NULL imdb_id CONTRIBUTES ZERO")
  && hasLoose("offers no safe proof of which addon it came from"));

check("OG2", "source_id is explicitly rejected as an ownership substitute",
  hasLoose("Do NOT use source_id as a cross-profile ownership substitute:")
  && hasLoose("two")
  && hasLoose("addons can produce the same source_id for entirely different titles."));

check("OG3", "a null-imdb event still participates in topology",
  hasLoose("An event with a null imdb_id still participates fully in topology"));

// -- H: the same IMDb id may be owned by two addons ---------------------------
check("OH1", "cross-addon duplication is explicitly allowed",
  hasLoose("CROSS-ADDON DUPLICATES ARE INTENTIONAL")
  && hasLoose("BOTH profiles may consume")
  && hasLoose("that title's feedback, each projecting it through its OWN registry and its own"));

check("OH2", "and it is stated not to be double-counting",
  hasLoose("That is correct and is not double-counting: they are separate taste")
  && hasLoose("models answering separate questions."));

check("OH3", "ownership is about which addon surfaced the title, not exclusivity",
  hasLoose("Ownership is about whether THIS addon")
  && hasLoose("surfaced the title, never about claiming exclusivity over it."));

// -- I: private fields still never reach public output ------------------------
check("OI1", "non-owned events are covered by the same public/private separation",
  hasLoose("Never expose their")
  && hasLoose("titles, ids, ratings, free text or any other private field")
  && hasLoose("the existing")
  && hasLoose("public/private separation rules apply to non-owned events exactly as they do to"));

check("OI2", "the standing forbidden-field list is untouched",
  has("The following must NEVER appear in this file, as key, value or text: rating, premise_interest"));

check("OI3", "the not-owned count is a diagnostic, and diagnostics are private",
  hasLoose("Record in your private diagnostic reasoning how many effective tips were")
  && hasLoose("excluded as not-owned"));

// -- the identity set is reused, not rebuilt ----------------------------------
check("OJ1", "ownership reuses the PHASE A identity set rather than rebuilding it",
  hasLoose("That identity set is already built once in PHASE A. Reuse it; do not rebuild it."));

// -- the filter must not have leaked into the public data ---------------------
check("OK1", "no ownership bookkeeping leaked into public output", (() => {
  const forbidden = ["not_owned", "ownership_filter", "owned_by", "profile_context", "source_addon"];
  const files = ["data/library.json", "data/personalized-scores.json", "config/catalogs.json"];
  return files.every(f => {
    if (!fs.existsSync(f)) return true;
    const body = fs.readFileSync(f, "utf8");
    return !forbidden.some(k => body.includes(k));
  });
})());

console.log("");
console.log(passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
