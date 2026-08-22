import fs from "node:fs";
const library = JSON.parse(fs.readFileSync("data/library.json", "utf8"));
const profile = JSON.parse(fs.readFileSync("data/taste-profile.json", "utf8"));
const validTypes = new Set(["movie", "series"]);
const validStatus = new Set(["watch", "seen"]);
const tags = new Set(profile.controlled_tags);
let errors = 0;
for (const [i, item] of library.items.entries()) {
  const prefix = `items[${i}] ${item.title || "?"}`;
  if (!validTypes.has(item.type)) { console.error(`${prefix}: invalid type`); errors++; }
  if (!validStatus.has(item.status)) { console.error(`${prefix}: invalid status`); errors++; }
  if (!item.title || !Number.isInteger(item.year)) { console.error(`${prefix}: missing title/year`); errors++; }
  if (item.imdb_id && !/^tt\d+$/.test(item.imdb_id)) { console.error(`${prefix}: invalid imdb_id`); errors++; }
  for (const tag of item.tags || []) if (!tags.has(tag)) console.warn(`${prefix}: unknown tag '${tag}'`);
}
if (errors) process.exit(1);
console.log(`Validation OK: ${library.items.length} items.`);
