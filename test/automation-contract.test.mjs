import assert from "node:assert/strict";
import fs from "node:fs";

const prompt = fs.readFileSync("DAILY_AUTOMATION_PROMPT.md", "utf8");
assert.ok(prompt.includes("scripts/rebuild-personalization.mjs"),
  "daily automation must delegate feedback resolution/personalization to repository code");
assert.ok(prompt.includes("schemas 1, 2 and 3"),
  "daily automation must explicitly recognize schemas 1, 2 and 3");
assert.ok(!prompt.includes("anything that is not 1 or 2"),
  "stale schema-3-as-unsupported wording must never return");
assert.ok(prompt.includes("must not abort the discovery run solely because personalization could not be refreshed"),
  "personalization refresh must not be a hard dependency of discovery publishing");
console.log("automation contract: OK");
