import assert from "node:assert/strict";
import { resolveFeedback, deriveSignals } from "../scripts/rebuild-personalization.mjs";

const publicItems = [
  {
    imdb_id: "tt1000001",
    type: "movie",
    title: "Owned Sci-Fi",
    year: 2024,
    status: "watch",
    dna: {
      mystery: 8,
      rule_discovery: 7,
      biology_genetics: 9,
      concept_escalation: 8,
      creature_threat: 4
    }
  }
];

const events = [
  {
    schema_version: 3,
    feedback_id: "owned-v3",
    supersedes: null,
    imdb_id: "tt1000001",
    source_id: "tt1000001",
    status: "seen",
    rating: 5,
    premise_interest: "yes",
    liked: ["mystery", "suspense"],
    disliked: ["ending_payoff"],
    profile_context: null,
    rated_at: "2026-09-06T10:00:00Z"
  },
  {
    schema_version: 3,
    feedback_id: "nonowned-v3",
    supersedes: null,
    imdb_id: "tt2000002",
    source_id: "tt2000002",
    status: "seen",
    rating: 1,
    premise_interest: "no",
    liked: ["creature_threat"],
    disliked: ["pacing", "military_focus"],
    profile_context: null,
    rated_at: "2026-09-06T11:00:00Z"
  },
  {
    schema_version: 4,
    feedback_id: "future-schema",
    supersedes: null,
    imdb_id: "tt3000003",
    source_id: "tt3000003",
    status: "seen",
    rating: 1,
    liked: ["mystery"],
    disliked: [],
    profile_context: null,
    rated_at: "2026-09-06T12:00:00Z"
  }
];

const tips = resolveFeedback(events);
const signals = deriveSignals({ tips, publicItems });

assert.deepEqual(signals.ratings, [5], "non-owned v3 numeric rating must remain profile-scoped");
assert.ok(signals.executionPreferences.get("pacing") < 0,
  "non-owned v3 execution feedback is universal and must remain usable");
assert.ok(signals.contentPreferences.get("creature_threat") > 0,
  "approved universal v3 concept feedback may cross profile ownership");
assert.ok(signals.contentPreferences.get("mystery") > 0,
  "owned v3 concept feedback must contribute");
assert.ok(signals.tonePreferences.get("suspense") > 0,
  "owned/null-context v3 tone feedback must contribute");
assert.equal(signals.tonePreferences.has("military_focus"), false,
  "non-owned v3 tone feedback must remain profile-scoped");
assert.equal(signals.unsupportedTips, 1,
  "schema 3 is supported; only schema 4 should be opaque in this fixture");

const superseded = resolveFeedback([
  { schema_version: 2, feedback_id: "old", supersedes: null, imdb_id: "tt1000001", status: "seen", rating: 1, rated_at: "2026-09-01T00:00:00Z" },
  { schema_version: 3, feedback_id: "new", supersedes: "old", imdb_id: "tt1000001", status: "seen", rating: 5, profile_context: null, rated_at: "2026-09-02T00:00:00Z" }
]);
assert.equal(superseded.length, 1);
assert.equal(superseded[0].feedback_id, "new", "schema-3 tips must supersede older schema-2 events normally");

console.log("personalization rebuild contract: OK");
