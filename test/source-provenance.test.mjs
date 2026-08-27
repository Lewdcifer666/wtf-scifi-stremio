// Sci-Fi product rule: every PUBLIC item cites at least TWO DISTINCT, real sources.
//
// `reason` is the card text. `source` is the material the research actually
// rested on, as URLs. Those are different jobs and the legacy seed records
// conflated them - all 79 carried the prose marker "conversation-seed", which
// is an assertion that research happened, not evidence of it.
//
// A REPEATED CITATION IS NOT A SECOND SOURCE. The count here is of DISTINCT
// normalized URLs, so a lookup that redirects back onto a page already cited
// buys nothing. The product standard is two useful sources: one carrying
// canonical identity and basic premise, one substantive enough to support the
// stored Content DNA.
//
// Run with: node test/source-provenance.test.mjs

import fs from "node:fs";
import path from "node:path";

let passed = 0, failed = 0;
const check = (id, description, condition, detail) => {
  if (condition) { passed++; console.log(`  ok   ${id}  ${description}`); }
  else { failed++; console.error(`  FAIL ${id}  ${description}${detail ? `\n         ${detail}` : ""}`); }
};

// MIRRORS THE ENGINE'S PARSER ON PURPOSE.
//
// scripts/validate.mjs splits on separators and parses each whole TOKEN as a
// URL. A regex that scans for a URL-shaped run instead would stop at the first
// ')' and silently truncate every Wikipedia disambiguation link -
// .../Minor_Premise_(film) would parse as .../Minor_Premise_( and the leftover
// 'film)' would look like prose. Tokenizing the same way the engine does keeps
// this test measuring the same thing the validator enforces.
const normalize = value => {
  try { const url = new URL(value); url.hash = ""; return url.href; }
  catch { return null; }
};
const urlsIn = source => String(source || "").split(/[;,\s]+/)
  .map(token => {
    const url = normalize(token.trim());
    if (!url) return null;
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return null;
    if (!parsed.hostname.includes(".")) return null;
    return url;
  })
  .filter(Boolean);
const proseRemainder = source => String(source || "").split(/[;,\s]+/)
  .filter(token => token.trim() && !normalize(token.trim()))
  .join(" ");

const items = [];
const push = (file, list) => list.forEach(it => items.push({ file, it }));
push("data/library.json", JSON.parse(fs.readFileSync("data/library.json", "utf8")).items);
for (const name of fs.readdirSync("data/discoveries").filter(f => f.endsWith(".json")).sort())
  push(`data/discoveries/${name}`,
    JSON.parse(fs.readFileSync(path.join("data/discoveries", name), "utf8")).items);

console.log("Source provenance");
console.log("");
console.log(`  ${items.length} public source items`);
console.log("");

// -- SP1: no prose-only provenance survives anywhere -------------------------
{
  const offenders = items.filter(({ it }) => urlsIn(it.source).length === 0);
  check("SP1", "every item cites at least one real http(s) URL",
    offenders.length === 0,
    offenders.slice(0, 5).map(o => `${o.it.title} -> ${JSON.stringify(o.it.source)}`).join("; "));
}

// -- SP2: the two-source product standard ------------------------------------
{
  const offenders = items.filter(({ it }) => new Set(urlsIn(it.source)).size < 2);
  check("SP2", "every item cites at least TWO DISTINCT sources",
    offenders.length === 0,
    offenders.slice(0, 5).map(o => `${o.it.title} -> ${new Set(urlsIn(o.it.source)).size}`).join("; "));
}

// -- SP3: a repeated citation is not a second source -------------------------
{
  const offenders = items.filter(({ it }) => {
    const list = urlsIn(it.source);
    return list.length !== new Set(list).size;
  });
  check("SP3", "no item reaches its count by citing the same URL twice",
    offenders.length === 0,
    offenders.slice(0, 5).map(o => o.it.title).join("; "));
}

// -- SP4: the legacy marker is gone for good ---------------------------------
{
  const offenders = items.filter(({ it }) => /conversation-seed/i.test(String(it.source || "")));
  check("SP4", "the legacy prose marker conversation-seed appears on no item",
    offenders.length === 0, `${offenders.length} items still carry it`);
}

// -- SP5: provenance is provenance, not an evidence summary ------------------
// A source field should be URLs and separators. Free prose in there is the exact
// defect this rule exists to prevent, so a long non-URL remainder fails.
{
  const offenders = items.filter(({ it }) => {
    return proseRemainder(it.source).length > 0;
  });
  check("SP5", "no item mixes prose into the source field",
    offenders.length === 0,
    offenders.slice(0, 5).map(o => `${o.it.title} -> ${JSON.stringify(o.it.source)}`).join("; "));
}

// -- SP6: the same document is not reused across different items -------------
// Not strictly required, but a corpus where two titles share a citation usually
// means a lookup silently redirected to a hub page.
{
  const seen = new Map();
  for (const { it } of items)
    for (const u of new Set(urlsIn(it.source)))
      seen.set(u, (seen.get(u) || 0) + 1);
  const shared = [...seen.entries()].filter(([, n]) => n > 1);
  check("SP6", "no single URL is cited by two different items",
    shared.length === 0, shared.slice(0, 5).map(([u, n]) => `${u} x${n}`).join("; "));
}

console.log("");
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
