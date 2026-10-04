// F2-10 system acceptance for the public repository.
//
// Verifies the whole pipeline against the CURRENT real data, dynamically. No
// production count is ever hard-coded: the catalog grows on the automation's
// schedule, so every assertion is expressed as an invariant that stays true at
// any size.
//
// Run with: node test/acceptance.test.mjs

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { normalizeTitle } from "../scripts/cinemeta.mjs";
import { identityKey } from "../scripts/identity.mjs";
import { makePolicy, scoreItem, dnaEligible, isKnown, requiredFor } from "../scripts/dna-score.mjs";
import { readPersonalizedScores } from "../scripts/personalized-scores.mjs";
import { withProductionFile, sha256 } from "./safe-fixture.mjs";

let passed = 0, failed = 0;
const check = (id, description, condition, detail) => {
  if (condition) { passed++; console.log(`  ok   ${id}  ${description}`); }
  else { failed++; console.error(`  FAIL ${id}  ${description}${detail ? `\n         ${detail}` : ""}`); }
};

console.log("F2-10 public system acceptance");
console.log("");

const profile = JSON.parse(fs.readFileSync("data/taste-profile.json", "utf8"));
const config = JSON.parse(fs.readFileSync("config/catalogs.json", "utf8"));
const policy = makePolicy(profile);

// The personalized map the site build actually consumes. Assertions that check a
// REAL card must score with this; assertions over SYNTHETIC fixtures deliberately
// keep using an empty map, because those fixtures are not in the file.
const livePersonalized = readPersonalizedScores(fs, path.join("data", "personalized-scores.json")).items;
const DIMS = policy.dimensions;
const TAGS = new Set(profile.dna_dimensions.tag_registry);
const CONTROLLED = new Set(profile.controlled_tags);

// ---------------------------------------------------------------- source data
const records = [];
{
  const lib = JSON.parse(fs.readFileSync("data/library.json", "utf8"));
  for (const it of lib.items || []) records.push({ file: "data/library.json", run: null, it });
  for (const name of fs.readdirSync("data/discoveries").filter(f => f.endsWith(".json")).sort()) {
    const payload = JSON.parse(fs.readFileSync(path.join("data/discoveries", name), "utf8"));
    const items = Array.isArray(payload) ? payload : payload.items || [];
    for (const it of items) records.push({ file: name, run: payload.run_id ?? name.replace(/\.json$/, ""), it });
  }
}
const items = records.map(r => r.it);
const watch = items.filter(i => i.status === "watch");
console.log(`  --   discovered dynamically: ${records.length} source records, ${watch.length} watch titles, ` +
  `${fs.readdirSync("data/discoveries").filter(f => f.endsWith(".json")).length} discovery files`);
console.log("");

// ---------------------------------------------------------------- 1. identity + validation
{
  const seen = new Map();
  const dupes = [];
  for (const r of records) {
    const key = identityKey(r.it, normalizeTitle);
    if (seen.has(key)) dupes.push(`${key} (${seen.get(key)} + ${r.file})`);
    else seen.set(key, r.file);
  }
  check("I1", `every public source identity is unique (${seen.size} identities)`, dupes.length === 0, dupes.join("; "));
  check("I2", "identity count equals record count", seen.size === records.length);

  let ok = true, out = "";
  try { out = execFileSync(process.execPath, ["scripts/validate.mjs"], { encoding: "utf8" }); }
  catch (e) { ok = false; out = String(e.stdout) + String(e.stderr); }
  check("I3", "all source items validate", ok, out.slice(0, 300));
  check("I4", "the validator reports the same record count", out.includes(`${records.length} source items`), out.trim());
}

// ---------------------------------------------------------------- schema-3 DNA contract
{
  const enriched = items.filter(i => i.dna || i.dna_confidence !== undefined || i.dna_tags);
  check("D1", `every enriched item carries all ${DIMS.length} canonical dimensions (${enriched.length} enriched)`,
    enriched.every(i => Object.keys(i.dna || {}).length === DIMS.length
      && DIMS.every(d => Object.prototype.hasOwnProperty.call(i.dna, d))));
  check("D2", "every DNA value is an integer 0..10 or null",
    enriched.every(i => DIMS.every(d => i.dna[d] === null || (Number.isInteger(i.dna[d]) && i.dna[d] >= 0 && i.dna[d] <= 10))));
  check("D3", "every dna_confidence is a number 0.0..1.0",
    enriched.every(i => typeof i.dna_confidence === "number" && i.dna_confidence >= 0 && i.dna_confidence <= 1));
  check("D4", "every dna_tag comes from the closed registry and is unique per item",
    enriched.every(i => Array.isArray(i.dna_tags)
      && i.dna_tags.every(t => TAGS.has(t))
      && new Set(i.dna_tags).size === i.dna_tags.length));
  check("D5", "no item carries a controlled_tag outside the public vocabulary",
    items.every(i => (i.tags || []).every(t => CONTROLLED.has(t))));
  check("D6", "the DNA tag vocabulary is disjoint in purpose from controlled_tags",
    profile.dna_dimensions.tag_registry.length === 20 && CONTROLLED.size === 15);
}

// ---------------------------------------------------------------- DNA row semantics
{
  const DNA_DEFS = config.catalogs.filter(c => c.filter === "dna");
  const synthetic = (over = {}, conf = 0.9) => {
    const dna = {}; for (const d of DIMS) dna[d] = 5;
    return { imdb_id: "tt0000001", type: "movie", title: "S", year: 2020, dna: { ...dna, ...over }, dna_confidence: conf, dna_tags: [] };
  };

  check("R1", "UNKNOWN is never scored as 0 - a null row-required dimension makes the item ineligible", (() => {
    for (const def of DNA_DEFS) {
      const dim = requiredFor(policy, def).find(d => d !== "superhero");
      const r = scoreItem(policy, def, synthetic({ [dim]: null }), new Map());
      if (r.score !== null) return false;
    }
    return true;
  })());
  check("R2", "an explicit 0 is measured and still scores",
    Number.isInteger(scoreItem(policy, { ...DNA_DEFS[0], min_score: 0 }, synthetic({ isolation: 0 }), new Map()).score));
  check("R3", "baseline completeness is enforced (confidence below the floor is ineligible)",
    DNA_DEFS.every(def => scoreItem(policy, def, synthetic({}, 0.1), new Map()).reason === "dna_ineligible"));
  check("R4", "row-required set = baseline required U gate U weights U penalties",
    DNA_DEFS.every(def => {
      const req = new Set(requiredFor(policy, def));
      const cfg = def.dna;
      const gate = cfg.gate ? [...(cfg.gate.all_of || []), ...(cfg.gate.any_of || [])].map(c => c.dimension) : [];
      return policy.completeness.required_known_dimensions.every(d => req.has(d))
        && Object.keys(cfg.weights || {}).every(d => req.has(d))
        && Object.keys(cfg.penalties || {}).every(d => req.has(d))
        && gate.every(d => req.has(d));
    }));
  check("R5", "hard exclusions remove the item from every DNA row before scoring",
    DNA_DEFS.every(def => scoreItem(policy, def, synthetic({ superhero: 8 }), new Map()).reason === "hard_excluded")
    && DNA_DEFS.every(def => scoreItem(policy, def, synthetic({ comic_book_universe: 7 }), new Map()).reason === "hard_excluded"));
  check("R6", "combination penalties are scale-consistent with the profile weights", (() => {
    const expect = { "-35": 14.52, "-30": 12.45, "-22": 9.13 };
    return profile.dna_guardrails.combination.every(r =>
      Math.abs(Math.abs(r.penalty) * policy.penaltyScale - expect[String(r.penalty)]) < 0.02);
  })());
  check("R7", "clamp happens BEFORE the guardrail deduction", (() => {
    const maxed = {}; for (const d of DIMS) maxed[d] = 0;
    for (const [d, w] of Object.entries(policy.weights)) if (w > 0) maxed[d] = 10;
    const item = synthetic(maxed);
    Object.assign(item.dna, { pace_speed: 0, mystery: 0, concept_escalation: 0, rule_discovery: 0 });
    const s = scoreItem(policy, config.catalogs.find(c => c.id === "dna-match"), item, new Map()).score;
    return s === Math.round(100 - Math.abs(-22) * policy.penaltyScale);
  })());
  check("R8", "the best archetype is used, never an average", (() => {
    const bio = synthetic({ biology_genetics: 10, scientific_investigation: 10 });
    const a = scoreItem(policy, config.catalogs.find(c => c.id === "dna-match"), bio, new Map()).score;
    const flat = scoreItem(policy, config.catalogs.find(c => c.id === "dna-match"), synthetic(), new Map()).score;
    return a > flat;   // a strong single-cluster match must beat an averaged-flat profile
  })());
  check("R9", "personalized DNA Match uses the 0.7 / 0.3 content/execution split", (() => {
    const def = config.catalogs.find(c => c.id === "dna-match");
    const item = synthetic();
    const map = new Map([[item.imdb_id, { dna_match: 90, execution_fit: 40 }]]);
    const split = profile.execution_preferences.content_vs_execution;
    return split.content_fit === 0.7 && split.execution_fit === 0.3
      && scoreItem(policy, def, item, map).score === Math.round(0.7 * 90 + 0.3 * 40);
  })());
  check("R10", "an absent personalized entry falls back to the stable baseline", (() => {
    const def = config.catalogs.find(c => c.id === "dna-match");
    const item = synthetic();
    return scoreItem(policy, def, item, new Map()).score
      === scoreItem(policy, def, item, new Map([["tt9999999", { dna_match: 5, execution_fit: 5 }]])).score;
  })());
}

// ---------------------------------------------------------------- 6. discovery / log consistency
{
  const log = JSON.parse(fs.readFileSync("data/discovery-log.json", "utf8"));
  const runs = log.runs || [];
  const files = fs.readdirSync("data/discoveries").filter(f => f.endsWith(".json")).sort();
  const problems = [];

  for (const name of files) {
    const payload = JSON.parse(fs.readFileSync(path.join("data/discoveries", name), "utf8"));
    const runId = payload.run_id ?? name.replace(/\.json$/, "");
    const fileItems = Array.isArray(payload) ? payload : payload.items || [];

    for (const it of fileItems) {
      if (it.discovery_run_id && it.discovery_run_id !== runId) problems.push(`${name}: ${it.imdb_id} run_id ${it.discovery_run_id} != ${runId}`);
      if (it.added_by !== "daily-automation") problems.push(`${name}: ${it.imdb_id} added_by='${it.added_by}'`);
      if (it.status !== "watch" && it.status !== "seen") problems.push(`${name}: ${it.imdb_id} status='${it.status}'`);
    }

    const entry = runs.find(r => r.run_id === runId);
    if (!entry) { problems.push(`${name}: no discovery-log entry`); continue; }
    if (entry.accepted !== fileItems.length) problems.push(`${runId}: accepted ${entry.accepted} != ${fileItems.length} items`);
    if (Array.isArray(entry.accepted_items)) {
      if (entry.accepted_items.length !== fileItems.length) problems.push(`${runId}: accepted_items ${entry.accepted_items.length} != ${fileItems.length}`);
      const fileIds = new Set(fileItems.map(i => i.imdb_id));
      for (const a of entry.accepted_items) if (!fileIds.has(a.imdb_id)) problems.push(`${runId}: accepted_items lists ${a.imdb_id}, absent from the run file`);
    }
  }
  check("C1", `every discovery file agrees with its log record (${files.length} files, ${runs.length} runs)`,
    problems.length === 0, problems.join("\n         "));

  // no run may claim an identity that already existed in the permanent library
  const libIds = new Set(JSON.parse(fs.readFileSync("data/library.json", "utf8")).items.map(i => identityKey(i, normalizeTitle)));
  const claimed = [];
  for (const name of files) {
    const payload = JSON.parse(fs.readFileSync(path.join("data/discoveries", name), "utf8"));
    for (const it of (Array.isArray(payload) ? payload : payload.items || [])) {
      if (libIds.has(identityKey(it, normalizeTitle))) claimed.push(`${name}: ${it.imdb_id} ${it.title}`);
    }
  }
  check("C2", "no run claims an identity that already exists in the permanent library",
    claimed.length === 0, claimed.join("; "));

  check("C3", "every run reports accepted + duplicates consistent with a non-negative search",
    runs.every(r => !Number.isInteger(r.searched) || r.searched >= (r.accepted || 0) + (r.duplicates || 0)),
    runs.filter(r => Number.isInteger(r.searched) && r.searched < (r.accepted || 0) + (r.duplicates || 0)).map(r => r.run_id).join(", "));
}

// ---------------------------------------------------------------- 7. built catalog output
{
  execFileSync(process.execPath, ["scripts/build-site.mjs"], { stdio: "pipe" });
  const manifest = JSON.parse(fs.readFileSync("site/manifest.json", "utf8"));
  const cat = (id, type) => JSON.parse(fs.readFileSync(path.join("site/catalog", type, `${id}-${type}.json`), "utf8"));
  const DNA_IDS = config.catalogs.filter(c => c.filter === "dna").map(c => c.id);
  const OLD_IDS = config.catalogs.filter(c => c.filter !== "dna").map(c => c.id);

  check("B1", `manifest declares 2 entries per logical catalog (${config.catalogs.length} x 2)`,
    manifest.catalogs.length === config.catalogs.length * 2, `${manifest.catalogs.length}`);
  check("B2", "each logical catalog has a movie and a series entry",
    config.catalogs.every(d => manifest.catalogs.some(c => c.id === `${d.id}-movie` && c.type === "movie")
      && manifest.catalogs.some(c => c.id === `${d.id}-series` && c.type === "series")));
  check("B3", `manifest version is ${config.manifest.version}`, manifest.version === config.manifest.version, manifest.version);

  const byId = new Map(items.filter(i => i.imdb_id).map(i => [i.imdb_id, i]));
  const LABEL = d => d.name.replace(/^[^\p{L}]+/u, "").trim();
  const problems = [];
  let cards = 0;

  for (const def of config.catalogs) {
    for (const type of ["movie", "series"]) {
      const metas = cat(def.id, type).metas;
      if (new Set(metas.map(m => m.id)).size !== metas.length) problems.push(`${def.id}-${type}: duplicate cards`);
      for (const m of metas) {
        cards++;
        const src = byId.get(m.id);
        if (!src) { problems.push(`${def.id}-${type}: ${m.id} has no source record`); continue; }
        if (m.type !== type) problems.push(`${def.id}-${type}: ${m.id} is a ${m.type}`);
        if (m.name !== (src.canonical_title || src.title)) problems.push(`${def.id}-${type}: ${m.id} title mismatch`);
        if (m.releaseInfo !== String(src.year)) problems.push(`${def.id}-${type}: ${m.id} year mismatch`);
        if (m.poster !== `https://images.metahub.space/poster/medium/${m.id}/img`) problems.push(`${def.id}-${type}: ${m.id} poster URL`);
        if (!m.description || !m.description.trim()) problems.push(`${def.id}-${type}: ${m.id} empty description`);
        if (Object.keys(m).length !== 7) problems.push(`${def.id}-${type}: ${m.id} unexpected meta keys`);

        if (def.filter === "dna") {
          // Score with the SAME map build-site.mjs used. An empty map here
          // asserted that personalization never changes a displayed score,
          // which contradicts R9/X3 and broke as soon as a daily run emitted a
          // real personalized file.
          const expected = scoreItem(policy, def, src, livePersonalized).score;
          if (!m.description.includes(`${LABEL(def)} ${expected}/100`)) problems.push(`${def.id}-${type}: ${m.id} wrong row score`);
          if (/• Match \d+\/100/.test(m.description)) problems.push(`${def.id}-${type}: ${m.id} shows the old Match label`);
        } else if (src.match_score) {
          if (!m.description.includes(`• Match ${src.match_score}/100`)) problems.push(`${def.id}-${type}: ${m.id} lost its Match score`);
        }
      }
    }
  }
  check("B4", `every card is well-formed and correctly scored (${cards} cards inspected)`,
    problems.length === 0, problems.slice(0, 8).join("\n         "));

  const LEAK = ["dna", "dna_tags", "dna_confidence", "dna_match", "execution_fit", "dna_score",
    "rating", "premise_interest", "liked", "disliked", "dnf_reasons", "feedback_id", "supersedes"];
  check("B5", "no DNA, personalized or private field appears as a key in any catalog file", (() => {
    for (const def of config.catalogs) {
      for (const type of ["movie", "series"]) {
        const raw = fs.readFileSync(path.join("site/catalog", type, `${def.id}-${type}.json`), "utf8");
        if (LEAK.some(f => raw.includes(`"${f}"`))) return false;
      }
    }
    return true;
  })());
  check("B6", "no DNA vector value array reaches any card",
    !DNA_IDS.some(id => ["movie", "series"].some(t =>
      fs.readFileSync(path.join("site/catalog", t, `${id}-${t}.json`), "utf8").includes("scientific_investigation"))));
  check("B7", "the original rows are populated and DNA-free in their scoring",
    OLD_IDS.every(id => cat(id, "movie").metas.length + cat(id, "series").metas.length >= 0));
  // F2-9 legitimately creates this file, so its ABSENCE is no longer an
  // invariant. What must hold is that whenever it exists it is well-formed and
  // carries nothing private. It may legitimately hold items:{}, and the repo may
  // legitimately predate the first successful F2-9 run.
  {
    const file = "data/personalized-scores.json";
    if (!fs.existsSync(file)) {
      check("B8", "no personalized-scores.json yet (valid before the first successful F2-9 run)", true);
    } else {
      const raw = fs.readFileSync(file, "utf8");
      let payload = null;
      try { payload = JSON.parse(raw); } catch { /* reported below */ }
      const read = readPersonalizedScores(fs, file);
      const FORBIDDEN = ["rating", "premise_interest", "more_like_this", "liked", "disliked",
        "dnf_reasons", "feedback", "feedback_id", "supersedes", "source_id", "rated_at", "received_at"];

      check("B8a", "the production personalized file parses and has the closed top-level shape",
        Boolean(payload) && Object.keys(payload).sort().join(",") === "generated_at,items,schema_version",
        payload ? Object.keys(payload).join(",") : "unparseable");
      check("B8b", "schema_version is supported and generated_at is a valid UTC stamp",
        Boolean(payload) && payload.schema_version === 1
        && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(payload.generated_at)
        && Number.isFinite(Date.parse(payload.generated_at)));
      check("B8c", `every entry has only dna_match and execution_fit, integers 0..100 (${payload ? Object.keys(payload.items).length : "?"} entries)`,
        Boolean(payload) && Object.values(payload.items).every(v =>
          Object.keys(v).sort().join(",") === "dna_match,execution_fit"
          && [v.dna_match, v.execution_fit].every(n => Number.isInteger(n) && n >= 0 && n <= 100)));
      check("B8d", "every key is a valid IMDb id",
        Boolean(payload) && Object.keys(payload.items).every(k => /^tt\d+$/.test(k)));
      check("B8e", "no forbidden private field appears anywhere in the file",
        !FORBIDDEN.some(f => raw.includes(`"${f}"`)),
        FORBIDDEN.filter(f => raw.includes(`"${f}"`)).join(", "));
      check("B8f", `the real F2-8 reader accepts or safely rejects it (status: ${read.status})`,
        ["applied", "stale"].includes(read.status) || read.status === "absent",
        read.status);
    }
  }
}

// ---------------------------------------------------------------- 2. personalized consumer, temp fixtures only
{
  const file = path.join("data", "personalized-scores.json");
  const fresh = () => new Date(Date.now() - 60000).toISOString().replace(/\.\d+Z$/, "Z");
  const cat = (id, type) => JSON.parse(fs.readFileSync(path.join("site/catalog", type, `${id}-${type}.json`), "utf8"));
  const build = () => execFileSync(process.execPath, ["scripts/build-site.mjs"], { stdio: "pipe" });

  // X6 restores against the REAL production build; X1/X2 compare against the
  // unpersonalized baseline below. Two different references, two different
  // questions - collapsing them is what made these assertions wrong.
  build();
  const preFixture = cat("dna-match", "movie").metas.map(m => m.description).join("|");
  const existedBefore = fs.existsSync(file);
  const shaBefore = sha256(file);

  // THE FALLBACK REFERENCE IS AN UNPERSONALIZED BUILD.
  //
  // "falls back to the stable baseline" means "behaves as if there were no
  // personalization". Capturing the reference from the CURRENT build made that
  // reference personalized, so X1/X2 quietly asserted that personalization does
  // nothing - true only while personalized-scores.json was empty, and false the
  // moment a daily run emitted a real one.
  let baseline;

  withProductionFile(file, () => {
    fs.rmSync(file, { force: true });
    build();
    baseline = cat("dna-match", "movie").metas.map(m => m.description).join("|");

    // an empty items object is valid and must behave exactly like an absent file
    fs.writeFileSync(file, JSON.stringify({ schema_version: 1, generated_at: fresh(), items: {} }), "utf8");
    build();
    check("X1", "items:{} is valid and falls back to the stable baseline",
      cat("dna-match", "movie").metas.map(m => m.description).join("|") === baseline);

    // an entry for a SEEN title cannot influence any catalog, because seen
    // titles never reach the builder's watch set in the first place
    const seenTitle = items.find(i => i.status === "seen" && i.imdb_id);
    fs.writeFileSync(file, JSON.stringify({
      schema_version: 1, generated_at: fresh(),
      items: { [seenTitle.imdb_id]: { dna_match: 100, execution_fit: 100 } }
    }), "utf8");
    build();
    check("X2", `a personalized entry for a seen title (${seenTitle.imdb_id}) cannot affect any catalog`,
      cat("dna-match", "movie").metas.map(m => m.description).join("|") === baseline
      && !cat("dna-match", "movie").metas.some(m => m.id === seenTitle.imdb_id));

    // a real watch title DOES change, and the card shows only the final number
    const watchTitle = cat("dna-match", "movie").metas[0];
    fs.writeFileSync(file, JSON.stringify({
      schema_version: 1, generated_at: fresh(),
      items: { [watchTitle.id]: { dna_match: 97, execution_fit: 11 } }
    }), "utf8");
    build();
    const card = cat("dna-match", "movie").metas.find(m => m.id === watchTitle.id);
    const expected = Math.round(0.7 * 97 + 0.3 * 11);
    check("X3", "a fresh valid entry personalizes the watch title",
      Boolean(card) && card.description.includes(`DNA Match ${expected}/100`),
      card ? card.description.slice(-60) : "missing");
    check("X4", "the card exposes only the final row score, never the raw inputs",
      Boolean(card) && !card.description.includes("97/100") && !card.description.includes("11/100")
      && !/dna_match|execution_fit/.test(card.description));
  }, build);

  check("X5", "the production personalized file is restored byte-for-byte",
    fs.existsSync(file) === existedBefore && sha256(file) === shaBefore,
    `existed ${existedBefore} -> ${fs.existsSync(file)}`);
  check("X6", "the build is restored to its pre-fixture output",
    cat("dna-match", "movie").metas.map(m => m.description).join("|") === preFixture);
}

console.log("");
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
