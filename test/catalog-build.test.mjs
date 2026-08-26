// F2-8 built-catalog regression tests.
//
// Builds the site and asserts the shape of what came out: the nine pre-F2-8
// catalogs are untouched, the manifest grew from 18 to 28 entries, the five new
// rows are populated and correctly sorted, and no catalog leaks DNA into a card
// description.
//
// Run with: node test/catalog-build.test.mjs

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { withProductionFile } from "./safe-fixture.mjs";

const SITE = "site";
const EXISTING_ROWS = [
  "full-watchlist", "past-24h", "best-matches", "biology-scientists",
  "impossible-systems", "reality-time-mind", "alien-unknown",
  "experiments-conspiracies", "mystery-suspense"
];
const NEW_ROWS = ["dna-match", "fringe-dna", "investigation-first", "high-suspense", "concept-escalating"];

let passed = 0, failed = 0;
const check = (id, description, condition, detail) => {
  if (condition) { passed++; console.log(`  ok   ${id}  ${description}`); }
  else { failed++; console.error(`  FAIL ${id}  ${description}${detail ? `\n         ${detail}` : ""}`); }
};

console.log("F2-8 catalog build");
console.log("");

execFileSync(process.execPath, ["scripts/build-site.mjs"], { stdio: "pipe" });
const read = f => JSON.parse(fs.readFileSync(path.join(SITE, f), "utf8"));
const manifest = read("manifest.json");
const catalog = (id, type) => read(path.join("catalog", type, `${id}-${type}.json`));

// ---------------------------------------------------------------- manifest
check("M1", "manifest declares 28 catalog entries", manifest.catalogs.length === 28, `got ${manifest.catalogs.length}`);
check("M2", "manifest version is 2.1.0", manifest.version === "2.1.0", manifest.version);
check("M3", "every logical row exists for both movie and series", (() => {
  const ids = new Set(manifest.catalogs.map(c => `${c.type}:${c.id}`));
  return [...EXISTING_ROWS, ...NEW_ROWS].every(r => ids.has(`movie:${r}-movie`) && ids.has(`series:${r}-series`));
})());
check("M4", "no catalog entry was removed", EXISTING_ROWS.every(r =>
  manifest.catalogs.some(c => c.id === `${r}-movie`) && manifest.catalogs.some(c => c.id === `${r}-series`)));
check("M5", "manifest id is unchanged", manifest.id === "com.github.wtfscifi.automated-watchlist", manifest.id);

// ---------------------------------------------------------------- determinism
{
  const snapshot = () => {
    execFileSync(process.execPath, ["scripts/build-site.mjs"], { stdio: "pipe" });
    const out = {};
    for (const type of ["movie", "series"]) {
      for (const row of [...EXISTING_ROWS, ...NEW_ROWS]) {
        out[`${row}-${type}`] = catalog(row, type).metas.map(m => m.id).join(",");
      }
    }
    return JSON.stringify(out);
  };
  const a = snapshot(), b = snapshot();
  check("D1", "two consecutive builds produce identical catalog contents and order", a === b);
}

// ---------------------------------------------------------------- new rows
for (const row of NEW_ROWS) {
  for (const type of ["movie", "series"]) {
    const metas = catalog(row, type).metas;
    check("N1", `${row}-${type} is populated (${metas.length})`, metas.length > 0);
    check("N2", `${row}-${type} contains only ${type} entries`, metas.every(m => m.type === type));
    check("N3", `${row}-${type} has unique ids`, new Set(metas.map(m => m.id)).size === metas.length);
  }
}

// ---------------------------------------------------------------- movie/series separation
check("S1", "no series appears in any movie catalog and vice versa", (() => {
  for (const row of [...EXISTING_ROWS, ...NEW_ROWS]) {
    if (catalog(row, "movie").metas.some(m => m.type !== "movie")) return false;
    if (catalog(row, "series").metas.some(m => m.type !== "series")) return false;
  }
  return true;
})());

// ---------------------------------------------------------------- privacy / leakage
// Substring-matching bare words like "mystery" or "lab" against the card text
// is meaningless - that prose lives in the pre-existing `reason` field and has
// always contained them. What matters is that a card carries no DNA-derived
// FIELD, and that appearing in a DNA row does not change how a card renders.
const META_KEYS = ["id", "type", "name", "poster", "posterShape", "releaseInfo", "description"];
const DNA_FIELDS = ["dna", "dna_tags", "dna_confidence", "dna_match", "execution_fit", "dna_score"];

check("L1", "every card exposes exactly the seven long-standing meta keys", (() => {
  for (const row of [...EXISTING_ROWS, ...NEW_ROWS]) {
    for (const type of ["movie", "series"]) {
      for (const meta of catalog(row, type).metas) {
        const keys = Object.keys(meta);
        if (keys.length !== META_KEYS.length || !META_KEYS.every(k => keys.includes(k))) return false;
        if (DNA_FIELDS.some(f => Object.prototype.hasOwnProperty.call(meta, f))) return false;
      }
    }
  }
  return true;
})());

check("L2", "a card's identity fields are identical in a DNA row and a pre-existing row", (() => {
  // Since the display fix the DESCRIPTION differs by design - a DNA row shows
  // its own row score. Everything identifying the title must still match.
  const IDENTITY = ["id", "type", "name", "poster", "posterShape", "releaseInfo"];
  const reference = new Map();
  for (const row of EXISTING_ROWS) {
    for (const type of ["movie", "series"]) {
      for (const meta of catalog(row, type).metas) reference.set(meta.id, meta);
    }
  }
  let compared = 0;
  for (const row of NEW_ROWS) {
    for (const type of ["movie", "series"]) {
      for (const meta of catalog(row, type).metas) {
        const seen = reference.get(meta.id);
        if (!seen) continue;
        if (!IDENTITY.every(k => seen[k] === meta[k])) return false;
        compared++;
      }
    }
  }
  return compared > 0;
})());

check("L3", "no DNA identifier appears as a JSON key anywhere in the generated catalogs", (() => {
  for (const row of [...EXISTING_ROWS, ...NEW_ROWS]) {
    for (const type of ["movie", "series"]) {
      const text = fs.readFileSync(path.join(SITE, "catalog", type, `${row}-${type}.json`), "utf8");
      if (DNA_FIELDS.some(f => text.includes(`"${f}"`))) return false;
    }
  }
  return true;
})());

// ---------------------------------------------------------------- build survives a broken personalized file
{
  const file = path.join("data", "personalized-scores.json");
  const existedBefore = fs.existsSync(file);
  const bytesBefore = existedBefore ? fs.readFileSync(file) : null;

  const baseline = catalog("dna-match", "movie").metas.map(m => m.id).join(",");
  let survived = true;
  const cases = [
    ["invalid JSON", "{not json"],
    ["unknown top-level key", JSON.stringify({ schema_version: 1, generated_at: "2026-08-25T00:00:00Z", items: {}, notes: "x" })],
    ["stale timestamp", JSON.stringify({ schema_version: 1, generated_at: "2020-01-01T00:00:00Z", items: {} })],
    ["privacy field on an item", JSON.stringify({ schema_version: 1, generated_at: new Date(Date.now() - 60000).toISOString().replace(/\.\d+Z$/, "Z"), items: { tt2299206: { dna_match: 90, execution_fit: 40, rating: 2 } } })]
  ];

  withProductionFile(file, () => {
    for (const [label, body] of cases) {
      fs.writeFileSync(file, body, "utf8");
      try {
        execFileSync(process.execPath, ["scripts/build-site.mjs"], { stdio: "pipe" });
      } catch {
        survived = false;
        console.error(`         build FAILED on: ${label}`);
        break;
      }
      if (catalog("dna-match", "movie").metas.map(m => m.id).join(",") !== baseline) {
        survived = false;
        console.error(`         fallback did not match baseline for: ${label}`);
        break;
      }
    }
  }, () => execFileSync(process.execPath, ["scripts/build-site.mjs"], { stdio: "pipe" }));

  check("B1", "every invalid personalized file still builds and falls back to baseline", survived);
  check("B2", "the production personalized file is restored byte-for-byte",
    fs.existsSync(file) === existedBefore
    && (!existedBefore || fs.readFileSync(file).equals(bytesBefore)));
}

// ---------------------------------------------------------------- displayed score
// A DNA row ranks by its own score, so the card must show THAT score - not the
// unrelated global match_score, which would contradict the visible ordering.
{
  const { makePolicy, scoreItem } = await import("../scripts/dna-score.mjs");
  const profile = JSON.parse(fs.readFileSync("data/taste-profile.json", "utf8"));
  const config = JSON.parse(fs.readFileSync("config/catalogs.json", "utf8"));
  const policy = makePolicy(profile);

  const source = [];
  {
    const lib = JSON.parse(fs.readFileSync("data/library.json", "utf8"));
    for (const it of lib.items || []) source.push(it);
    for (const n of fs.readdirSync("data/discoveries").filter(x => x.endsWith(".json")).sort()) {
      const payload = JSON.parse(fs.readFileSync(path.join("data/discoveries", n), "utf8"));
      for (const it of (Array.isArray(payload) ? payload : payload.items || [])) source.push(it);
    }
  }
  const byId = new Map(source.map(i => [i.imdb_id, i]));
  const LABELS = {
    "dna-match": "DNA Match",
    "fringe-dna": "Fringe DNA",
    "investigation-first": "Investigation First",
    "high-suspense": "High Suspense",
    "concept-escalating": "Concept Keeps Escalating"
  };
  const BULLET = "\u2022";
  const OLD_MATCH_RE = new RegExp(BULLET + " Match \\d+/100");

  // 2 + 3: every DNA card shows its own row's actual final score
  for (const row of NEW_ROWS) {
    const def = config.catalogs.find(c => c.id === row);
    let allMatch = true, checked = 0, sample = "";
    for (const type of ["movie", "series"]) {
      for (const meta of catalog(row, type).metas) {
        const expected = scoreItem(policy, def, byId.get(meta.id), new Map()).score;
        const needle = BULLET + " " + LABELS[row] + " " + expected + "/100";
        if (!meta.description.includes(needle)) {
          allMatch = false;
          sample = meta.name + ': expected "' + needle + '" in "' + meta.description.slice(-70) + '"';
        }
        checked++;
      }
    }
    check("V1", row + " cards display the actual " + LABELS[row] + " score (" + checked + " cards)",
      allMatch && checked > 0, sample);
  }

  // 4: the old match_score is never presented as the DNA score
  check("V2", "no DNA card carries the old bullet-Match-N/100 label", (() => {
    for (const row of NEW_ROWS) {
      for (const type of ["movie", "series"]) {
        for (const meta of catalog(row, type).metas) {
          if (OLD_MATCH_RE.test(meta.description)) return false;
        }
      }
    }
    return true;
  })());

  check("V3", "a DNA row shows its own score even when match_score differs", (() => {
    const def = config.catalogs.find(c => c.id === "dna-match");
    let found = 0;
    for (const type of ["movie", "series"]) {
      for (const meta of catalog("dna-match", type).metas) {
        const item = byId.get(meta.id);
        const dnaScore = scoreItem(policy, def, item, new Map()).score;
        if (!item.match_score || item.match_score === dnaScore) continue;
        found++;
        if (!meta.description.includes("DNA Match " + dnaScore + "/100")) return false;
        if (meta.description.includes("Match " + item.match_score + "/100")) return false;
      }
    }
    return found > 0;
  })());

  // 1: the nine pre-existing rows still show the old label and the item's own score
  check("V4", "the nine original rows still display the original Match score", (() => {
    let checked = 0;
    for (const row of EXISTING_ROWS) {
      for (const type of ["movie", "series"]) {
        for (const meta of catalog(row, type).metas) {
          const item = byId.get(meta.id);
          if (Object.values(LABELS).some(l => meta.description.includes(l + " "))) return false;
          if (item.match_score && !meta.description.includes(BULLET + " Match " + item.match_score + "/100")) return false;
          checked++;
        }
      }
    }
    return checked > 0;
  })());

  // 5 + 6: personalization changes only the single final number on the card
  {
    const file = path.join("data", "personalized-scores.json");
    const def = config.catalogs.find(c => c.id === "dna-match");
    const target = catalog("dna-match", "movie").metas[0];
    const RAW_MATCH = 97;
    const RAW_EXEC = 12;
    const expected = scoreItem(policy, def, byId.get(target.id),
      new Map([[target.id, { dna_match: RAW_MATCH, execution_fit: RAW_EXEC }]])).score;

    const existedBefore = fs.existsSync(file);
    const bytesBefore = existedBefore ? fs.readFileSync(file) : null;

    withProductionFile(file, () => {
      fs.writeFileSync(file, JSON.stringify({
        schema_version: 1,
        generated_at: new Date(Date.now() - 60000).toISOString().replace(/\.\d+Z$/, "Z"),
        items: { [target.id]: { dna_match: RAW_MATCH, execution_fit: RAW_EXEC } }
      }), "utf8");
      execFileSync(process.execPath, ["scripts/build-site.mjs"], { stdio: "pipe" });

      const card = catalog("dna-match", "movie").metas.find(m => m.id === target.id);
      check("V5", "a personalized card shows only the final combined score",
        Boolean(card) && card.description.includes("DNA Match " + expected + "/100"),
        card ? card.description.slice(-70) : "card missing");
      check("V6", "the raw dna_match and execution_fit inputs never appear on the card",
        Boolean(card)
        && !card.description.includes(RAW_MATCH + "/100")
        && !card.description.includes(RAW_EXEC + "/100")
        && !/dna_match|execution_fit|dna_confidence|dna_tags/.test(card.description),
        card ? card.description.slice(-70) : "card missing");
      check("V7", "personalization changes the displayed score but not the card identity",
        Boolean(card) && card.id === target.id && card.name === target.name && card.poster === target.poster);
    }, () => execFileSync(process.execPath, ["scripts/build-site.mjs"], { stdio: "pipe" }));

    check("V8", "the production personalized file is restored byte-for-byte",
      fs.existsSync(file) === existedBefore
      && (!existedBefore || fs.readFileSync(file).equals(bytesBefore)));
  }
}

console.log("");
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
