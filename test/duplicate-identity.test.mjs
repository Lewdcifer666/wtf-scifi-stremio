// Duplicate public identity must be a hard failure.
//
// A title may appear exactly once across data/library.json and every
// data/discoveries/*.json. This used to be a console warning, which is how the
// 2026-08-25 automation run managed to re-add two titles that were already in
// the permanent library without anything failing.
//
// Each case runs the REAL validate.mjs and build-site.mjs against a temporary
// copy of the repository, so the tests exercise the shipped scripts rather than
// a reimplementation of their rules.
//
// Run with: node test/duplicate-identity.test.mjs

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

let passed = 0, failed = 0;
const check = (id, description, condition, detail) => {
  if (condition) { passed++; console.log(`  ok   ${id}  ${description}`); }
  else { failed++; console.error(`  FAIL ${id}  ${description}${detail ? `\n         ${detail}` : ""}`); }
};

console.log("Duplicate public identity");
console.log("");

// ---------------------------------------------------------------- sandbox
const REPO = process.cwd();
function sandbox(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dupe-"));
  for (const sub of ["scripts", "config", "data", "data/discoveries"]) {
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
  }
  for (const f of fs.readdirSync(path.join(REPO, "scripts"))) {
    fs.copyFileSync(path.join(REPO, "scripts", f), path.join(dir, "scripts", f));
  }
  fs.copyFileSync(path.join(REPO, "config/catalogs.json"), path.join(dir, "config/catalogs.json"));
  for (const f of ["library.json", "taste-profile.json"]) {
    fs.copyFileSync(path.join(REPO, "data", f), path.join(dir, "data", f));
  }
  for (const f of fs.readdirSync(path.join(REPO, "data/discoveries"))) {
    fs.copyFileSync(path.join(REPO, "data/discoveries", f), path.join(dir, "data/discoveries", f));
  }
  mutate({
    dir,
    readLibrary: () => JSON.parse(fs.readFileSync(path.join(dir, "data/library.json"), "utf8")),
    writeLibrary: v => fs.writeFileSync(path.join(dir, "data/library.json"), JSON.stringify(v, null, 2) + "\n", "utf8"),
    writeDiscovery: (name, items) =>
      fs.writeFileSync(path.join(dir, "data/discoveries", name), JSON.stringify({ schema_version: 1, items }, null, 2) + "\n", "utf8")
  });
  return dir;
}

function run(dir, script) {
  try {
    execFileSync(process.execPath, [path.join("scripts", script)], { cwd: dir, stdio: "pipe" });
    return { ok: true, output: "" };
  } catch (error) {
    return { ok: false, output: String(error.stdout || "") + String(error.stderr || "") };
  }
}

const cleanup = dir => fs.rmSync(dir, { recursive: true, force: true });

// a minimal well-formed discovery item cloned from a real library record
function cloneItem(source, overrides) {
  return { ...JSON.parse(JSON.stringify(source)), added_by: "daily-automation", added_at: "2026-08-25T06:00:00Z", ...overrides };
}

// ---------------------------------------------------------------- 1. unique identities pass
{
  const dir = sandbox(() => {});
  const v = run(dir, "validate.mjs");
  const b = run(dir, "build-site.mjs");
  check("U1", "the current repository validates with no duplicates", v.ok, v.output.slice(0, 400));
  check("U2", "the current repository builds", b.ok, b.output.slice(0, 400));
  cleanup(dir);
}

// ---------------------------------------------------------------- 2. library + discovery duplicate
{
  let title = "";
  const dir = sandbox(ctx => {
    const lib = ctx.readLibrary();
    const existing = lib.items.find(i => i.imdb_id === "tt0084787");   // The Thing
    title = existing.title;
    ctx.writeDiscovery("2026-09-01-zz.json", [cloneItem(existing)]);
  });
  const v = run(dir, "validate.mjs");
  const b = run(dir, "build-site.mjs");
  check("D1", `duplicate IMDb id across library and a discovery file fails validation (${title})`,
    !v.ok && v.output.includes("duplicate public identity") && v.output.includes("tt0084787"), v.output.slice(0, 300));
  check("D2", "and fails the build closed rather than silently merging",
    !b.ok && b.output.includes("duplicate public identity"), b.output.slice(0, 300));
  cleanup(dir);
}

// ---------------------------------------------------------------- 3. duplicate across two discovery files
{
  const dir = sandbox(ctx => {
    const lib = ctx.readLibrary();
    const source = lib.items.find(i => i.imdb_id === "tt0084787");
    const fresh = cloneItem(source, { imdb_id: "tt9999901", title: "Duplicated Across Runs" });
    ctx.writeDiscovery("2026-09-01-aa.json", [fresh]);
    ctx.writeDiscovery("2026-09-02-bb.json", [JSON.parse(JSON.stringify(fresh))]);
  });
  const v = run(dir, "validate.mjs");
  const b = run(dir, "build-site.mjs");
  check("D3", "duplicate across two discovery files fails validation",
    !v.ok && v.output.includes("duplicate public identity") && v.output.includes("tt9999901"), v.output.slice(0, 300));
  check("D4", "and fails the build",
    !b.ok && b.output.includes("duplicate public identity"), b.output.slice(0, 300));
  cleanup(dir);
}

// ---------------------------------------------------------------- 4. identical DNA is still a duplicate
{
  const dir = sandbox(ctx => {
    const lib = ctx.readLibrary();
    const existing = lib.items.find(i => i.imdb_id === "tt1017460");   // Splice
    ctx.writeDiscovery("2026-09-03-cc.json", [cloneItem(existing)]);   // byte-identical DNA
  });
  const v = run(dir, "validate.mjs");
  check("D5", "a duplicate is invalid even when both copies carry identical DNA",
    !v.ok && v.output.includes("duplicate public identity"), v.output.slice(0, 300));
  cleanup(dir);
}

// ---------------------------------------------------------------- 5. fallback identity (no IMDb id)
{
  const dir = sandbox(ctx => {
    const lib = ctx.readLibrary();
    const source = lib.items.find(i => i.imdb_id === "tt0084787");
    const a = cloneItem(source, { title: "Nameless Phenomenon", year: 2019 });
    const b = cloneItem(source, { title: "nameless   phenomenon", year: 2019 });
    delete a.imdb_id; delete b.imdb_id;
    delete a.canonical_title; delete b.canonical_title;
    ctx.writeDiscovery("2026-09-04-dd.json", [a, b]);
  });
  const v = run(dir, "validate.mjs");
  check("D6", "duplicate fallback identity (normalized title + year + type) fails validation",
    !v.ok && v.output.includes("duplicate public identity"), v.output.slice(0, 300));
  cleanup(dir);
}

// ---------------------------------------------------------------- 6. near-misses still pass
{
  const dir = sandbox(ctx => {
    const lib = ctx.readLibrary();
    const source = lib.items.find(i => i.imdb_id === "tt0084787");
    const a = cloneItem(source, { imdb_id: "tt9999902", title: "Distinct Title A", year: 2019 });
    const b = cloneItem(source, { imdb_id: "tt9999903", title: "Distinct Title A", year: 2021 });   // same title, different year
    ctx.writeDiscovery("2026-09-05-ee.json", [a, b]);
  });
  const v = run(dir, "validate.mjs");
  const b = run(dir, "build-site.mjs");
  check("D7", "different years with the same title are NOT duplicates", v.ok, v.output.slice(0, 300));
  check("D8", "and the build still succeeds", b.ok, b.output.slice(0, 300));
  cleanup(dir);
}

// ---------------------------------------------------------------- 7. the repaired run
{
  const payload = JSON.parse(fs.readFileSync("data/discoveries/2026-08-25-d1.json", "utf8"));
  const items = Array.isArray(payload) ? payload : payload.items;
  const log = JSON.parse(fs.readFileSync("data/discovery-log.json", "utf8"));
  const runEntry = log.runs.find(r => r.run_id === "2026-08-25-d1");

  check("R1", "the 2026-08-25 run holds 6 discovery items", items.length === 6, `got ${items.length}`);
  check("R2", "neither repaired duplicate remains in the run",
    !items.some(i => i.imdb_id === "tt3839880" || i.imdb_id === "tt1017460"));
  check("R3", "run accounting is searched 23 / accepted 6 / duplicates 2 / rejected 15",
    runEntry.searched === 23 && runEntry.accepted === 6 && runEntry.duplicates === 2 && runEntry.rejected === 15,
    JSON.stringify({ s: runEntry.searched, a: runEntry.accepted, d: runEntry.duplicates, r: runEntry.rejected }));
  check("R4", "accepted_items lists exactly the 6 surviving titles",
    runEntry.accepted_items.length === 6
    && !runEntry.accepted_items.some(i => i.imdb_id === "tt3839880" || i.imdb_id === "tt1017460"));
  check("R5", "accepted count equals the number of accepted_items",
    runEntry.accepted === runEntry.accepted_items.length);
  check("R6", "the canonical library copies of both titles survive intact", (() => {
    const lib = JSON.parse(fs.readFileSync("data/library.json", "utf8"));
    return ["tt3839880", "tt1017460"].every(id => {
      const item = lib.items.find(i => i.imdb_id === id);
      return item && item.dna && Object.keys(item.dna).length === 27;
    });
  })());
}

console.log("");
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
