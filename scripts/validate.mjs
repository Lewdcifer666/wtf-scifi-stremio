import fs from "node:fs";
import path from "node:path";
import { validateProfile, validateItemDna } from "./validate-profile.mjs";

const library = JSON.parse(fs.readFileSync("data/library.json", "utf8"));
const profile = JSON.parse(fs.readFileSync("data/taste-profile.json", "utf8"));

const profileErrors = validateProfile(profile);
for (const message of profileErrors) console.error(`taste-profile.json: ${message}`);

const validTypes = new Set(["movie", "series"]);
const validStatus = new Set(["watch", "seen"]);
const tags = new Set(profile.controlled_tags);
const all = [...(library.items || [])];

const discoveryDir = path.join("data", "discoveries");
if (fs.existsSync(discoveryDir)) {
  for (const name of fs.readdirSync(discoveryDir).filter(x => x.toLowerCase().endsWith(".json")).sort()) {
    const payload = JSON.parse(fs.readFileSync(path.join(discoveryDir, name), "utf8"));
    const items = Array.isArray(payload) ? payload : (payload.items || []);
    if (!Array.isArray(items)) {
      console.error(`${name}: expected an items array`);
      process.exit(1);
    }
    for (const item of items) all.push(item);
  }
}

// Item-level DNA is validated against the registry the profile actually
// declares. On a schema-2 profile there is no registry, so DNA keys on items
// are reported rather than silently accepted.
const dnaDimensionIds = new Set((profile.dna_dimensions?.dimensions || []).map(d => d.id));
const dnaTagIds = new Set(profile.dna_dimensions?.tag_registry || []);

let errors = profileErrors.length;
const seenKeys = new Map();

for (const [i, item] of all.entries()) {
  const prefix = `items[${i}] ${item.title || "?"}`;
  if (!validTypes.has(item.type)) { console.error(`${prefix}: invalid type`); errors++; }
  if (!validStatus.has(item.status)) { console.error(`${prefix}: invalid status`); errors++; }
  if (!item.title || !Number.isInteger(item.year)) { console.error(`${prefix}: missing title/year`); errors++; }
  if (item.imdb_id && !/^tt\d+$/.test(item.imdb_id)) { console.error(`${prefix}: invalid imdb_id`); errors++; }
  for (const tag of item.tags || []) if (!tags.has(tag)) { console.error(`${prefix}: unknown tag '${tag}'`); errors++; }

  for (const message of validateItemDna(item, dnaDimensionIds, dnaTagIds)) {
    console.error(`${prefix}: ${message}`);
    errors++;
  }

  const key = item.imdb_id ? `${item.type}:${item.imdb_id}` : `${item.type}:${String(item.title || "").toLowerCase()}:${item.year}`;
  if (seenKeys.has(key)) console.warn(`${prefix}: duplicate source key also seen at index ${seenKeys.get(key)} (${key})`);
  else seenKeys.set(key, i);
}

if (errors) process.exit(1);
console.log(`Validation OK: ${all.length} source items.`);
