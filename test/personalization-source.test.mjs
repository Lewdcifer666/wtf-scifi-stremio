import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadCompleteFeedback, publishOutputs, resolveFeedback, buildPersonalizedSnapshot } from "../scripts/rebuild-personalization.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "wtf-feedback-source-"));
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
}).trim();
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value) + "\n");
};
const event = (feedback_id, extra = {}) => ({
  schema_version: 3, feedback_id, supersedes: null, imdb_id: "tt1000001",
  status: "seen", rating: 5, profile_context: "scifi", premise_interest: "yes",
  liked: ["mystery", "acting"], disliked: [], rated_at: "2026-09-01T00:00:00Z", ...extra
});
const old = event("old", { rating: 1 });
const correction = event("correction", { supersedes: "old", rated_at: "2026-09-02T00:00:00Z" });
const second = event("second", { imdb_id: "tt1000002", rating: 4 });
let cases = 0;
const check = (name, fn) => { fn(); cases++; console.log(`  ok   ${name}`); };

try {
  const origin = path.join(temp, "origin.git"), checkout = path.join(temp, "feedback");
  fs.mkdirSync(origin); fs.mkdirSync(checkout);
  git(origin, "init", "--bare", "--initial-branch=main");
  git(checkout, "init", "--initial-branch=main");
  git(checkout, "config", "user.name", "Synthetic Test");
  git(checkout, "config", "user.email", "fixture@example.invalid");
  git(checkout, "config", "core.autocrlf", "false");
  git(checkout, "remote", "add", "origin", origin);
  write(path.join(checkout, "events", "old.json"), old);
  write(path.join(checkout, "events", "nested", "correction.json"), correction);
  write(path.join(checkout, "events", "second.json"), second);
  write(path.join(checkout, "settings.json"), { metadata: true });
  write(path.join(checkout, ".gitignore"), "ignored.json\n");
  git(checkout, "add", "."); git(checkout, "commit", "-m", "Complete synthetic history");
  git(checkout, "push", "origin", "main");
  const initial = git(checkout, "rev-parse", "HEAD");
  const load = (feedbackDir = "events") => loadCompleteFeedback({ feedbackRepo: checkout, feedbackDir });
  const source = load();
  check("inventory includes nested, superseded and current events", () => {
    assert.equal(source.head, initial); assert.equal(source.eventCount, 3);
    assert.deepEqual(source.events.map(e => e.feedback_id).sort(), ["correction", "old", "second"]);
    assert.deepEqual(resolveFeedback(source.events).map(e => e.feedback_id), ["correction", "second"]);
  });
  check("partial selected directory is rejected", () => assert.throws(() => load("events/nested"), /incomplete feedback directory/));
  check("path traversal and missing event directory are rejected", () => {
    assert.throws(() => load("../events"), /repository-relative/);
    assert.throws(() => load("missing"), /Git verification failed/);
  });
  for (const [label, file] of [["dirty", "events/old.json"], ["untracked", "events/untracked.json"], ["ignored", "ignored.json"]]) {
    const target = path.join(checkout, file), original = fs.existsSync(target) ? fs.readFileSync(target) : null;
    write(target, event(label));
    check(`${label} source cannot be published`, () => assert.throws(load, /uncommitted, untracked or ignored/));
    if (original) fs.writeFileSync(target, original); else fs.rmSync(target);
  }
  check("dangling correction fails closed", () => assert.throws(() => resolveFeedback([correction]), /superseded event is missing/));
  check("cycles and duplicate ids fail closed", () => {
    assert.throws(() => resolveFeedback([event("a", { supersedes: "b" }), event("b", { supersedes: "a" })]), /cycle/);
    assert.throws(() => resolveFeedback([old, old]), /duplicate feedback_id/);
  });
  check("malformed feedback is not silently discarded", () => {
    for (const invalid of [null, {}, event("bad", { schema_version: 4 }), event("bad", { rated_at: "2026-02-30T00:00:00Z" }), event("bad", { rating: 99 })]) {
      assert.throws(() => resolveFeedback([old, invalid]));
    }
  });

  // Pure rebuilds are deterministic under input ordering and leave inputs alone.
  const profile = JSON.parse(fs.readFileSync(path.join(root, "data/taste-profile.json"), "utf8"));
  const catalogs = JSON.parse(fs.readFileSync(path.join(root, "config/catalogs.json"), "utf8"));
  const dna = Object.fromEntries(profile.dna_dimensions.dimensions.map(d => [d.id, profile.dna_baseline.weights[d.id] < 0 ? 0 : 7]));
  for (const exclusion of profile.dna_guardrails.hard_exclusion) dna[exclusion.dimension] = 0;
  const publicItems = ["tt1000001", "tt1000002"].map(imdb_id => ({
    imdb_id, type: "movie", title: `Synthetic ${imdb_id}`, year: 2024, status: "watch",
    dna, dna_confidence: 1, dna_tags: []
  }));
  const executionEvidence = Object.fromEntries(publicItems.map(x => [x.imdb_id, { acting: 1 }]));
  const inputs = { profile, catalogs, publicItems, feedbackEvents: source.events, executionEvidence, generatedAt: "2026-09-27T00:00:00Z" };
  check("complete rebuild is deterministic and produces usable items", () => {
    const before = JSON.stringify(inputs), built = buildPersonalizedSnapshot(inputs);
    assert.ok(Object.keys(built.snapshot.items).length > 0);
    assert.deepEqual(built, buildPersonalizedSnapshot({ ...inputs, feedbackEvents: [...source.events].reverse() }));
    assert.equal(JSON.stringify(inputs), before);
  });

  const publicRoot = path.join(temp, "public");
  write(path.join(publicRoot, "data/library.json"), { items: publicItems });
  write(path.join(publicRoot, "data/taste-profile.json"), profile);
  write(path.join(publicRoot, "config/catalogs.json"), catalogs);
  const evidenceFile = path.join(temp, "evidence.json"); write(evidenceFile, executionEvidence);
  const snapshotFile = path.join(temp, "snapshot.json"), signalsFile = path.join(temp, "signals.json");
  const priorSnapshot = "expired snapshot must survive failure\n", priorSignals = "prior signals\n";
  const resetOutputs = () => { write(snapshotFile, priorSnapshot); write(signalsFile, priorSignals); };
  const assertPreserved = () => {
    assert.equal(fs.readFileSync(snapshotFile, "utf8"), priorSnapshot);
    assert.equal(fs.readFileSync(signalsFile, "utf8"), priorSignals);
    assert.equal(fs.readdirSync(temp).filter(x => x.startsWith(".personalization-")).length, 0);
  };
  const cli = extra => spawnSync(process.execPath, [path.join(root, "scripts/rebuild-personalization.mjs"),
    "--public-root", publicRoot, "--feedback-repo", checkout, "--feedback-dir", "events",
    "--execution-evidence", evidenceFile, "--signals-output", signalsFile, "--output", snapshotFile, ...extra
  ], { encoding: "utf8" });
  check("CLI writes only a freshly rebuilt complete snapshot", () => {
    resetOutputs(); const result = cli([]); assert.equal(result.status, 0, result.stderr);
    const snapshot = JSON.parse(fs.readFileSync(snapshotFile, "utf8"));
    assert.equal(snapshot.schema_version, 1); assert.ok(Object.keys(snapshot.items).length > 0);
    assert.ok(Math.abs(Date.now() - Date.parse(snapshot.generated_at)) < 10000);
    assert.ok(result.stderr.includes(initial)); assert.equal(git(checkout, "status", "--porcelain"), "");
  });
  check("arbitrary snapshots and timestamp overrides cannot refresh output", () => {
    for (const args of [["--feedback-snapshot", evidenceFile], ["--generated-at", "2099-01-01T00:00:00Z"]]) {
      resetOutputs(); const result = cli(args); assert.notEqual(result.status, 0); assertPreserved();
    }
  });
  check("CLI preserves both outputs on malformed or partial source", () => {
    resetOutputs(); write(path.join(checkout, "events/old.json"), "{broken");
    const result = cli([]); assert.notEqual(result.status, 0); assertPreserved();
    write(path.join(checkout, "events/old.json"), old);
  });
  check("output cannot be written inside the read-only source", () => {
    assert.throws(() => publishOutputs([{ file: path.join(checkout, "leak.json"), text: "x" }], source), /outside the read-only/);
    assert.equal(fs.existsSync(path.join(checkout, "leak.json")), false);
  });

  const advanceOrigin = () => {
    write(path.join(checkout, "settings.json"), { changed: true });
    git(checkout, "add", "settings.json"); git(checkout, "commit", "-m", "Source advanced");
    git(checkout, "push", "origin", "main");
  };
  check("source movement between output replacements rolls both outputs back", () => {
    resetOutputs(); let calls = 0;
    assert.throws(() => publishOutputs([
      { file: signalsFile, text: "new signals" }, { file: snapshotFile, text: "new snapshot" }
    ], { ...source, assertCurrent() { if (++calls === 2) advanceOrigin(); source.assertCurrent(); } }), /HEAD changed/);
    assertPreserved();
  });
  check("a stale checkout cannot refresh an expired snapshot", () => {
    git(checkout, "checkout", "--detach", initial);
    resetOutputs(); const result = cli([]); assert.notEqual(result.status, 0);
    assert.match(result.stderr, /not at the current origin/); assertPreserved();
  });
  git(checkout, "checkout", "main");
  for (const [name, relative, payload, expected] of [
    ["committed malformed event", "events/bad.json", "{broken", /source JSON/],
    ["committed dangling correction", "events/bad.json", event("dangling", { supersedes: "missing" }), /superseded event is missing/],
    ["omitted event array outside selected directory", "archive.json", { events: [event("outside")] }, /incomplete feedback directory/]
  ]) {
    const file = path.join(checkout, relative);
    write(file, payload); git(checkout, "add", relative); git(checkout, "commit", "-m", `Fixture: ${name}`); git(checkout, "push", "origin", "main");
    check(`${name} preserves existing output`, () => {
      resetOutputs(); const result = cli([]); assert.notEqual(result.status, 0);
      assert.match(result.stderr, expected); assertPreserved();
    });
    fs.rmSync(file); git(checkout, "add", relative); git(checkout, "commit", "-m", "Restore complete fixture"); git(checkout, "push", "origin", "main");
  }
  check("an unreachable origin cannot refresh an expired snapshot", () => {
    git(checkout, "remote", "set-url", "origin", path.join(temp, "does-not-exist.git"));
    resetOutputs(); assert.notEqual(cli([]).status, 0); assertPreserved();
  });
  console.log(`Personalization source: ${cases} cases passed using synthetic local Git repositories.`);
} finally {
  if (path.dirname(temp) !== path.resolve(os.tmpdir())) throw new Error("unexpected fixture root");
  fs.rmSync(temp, { recursive: true, force: true });
}
