import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveItem } from "./cinemeta.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const out = path.join(root, "site");
const library = JSON.parse(fs.readFileSync(path.join(root, "data", "library.json"), "utf8"));
const config = JSON.parse(fs.readFileSync(path.join(root, "config", "catalogs.json"), "utf8"));
const taste = JSON.parse(fs.readFileSync(path.join(root, "data", "taste-profile.json"), "utf8"));

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const now = Date.now();
const H24 = 24 * 60 * 60 * 1000;
const watch = [];

for (const original of library.items.filter(x => x.status === "watch")) {
  let item = original;
  try {
    if (!item.imdb_id) item = await resolveItem(item);
  } catch (error) {
    console.warn(`Skipping unresolved item: ${error.message}`);
    continue;
  }
  watch.push(item);
}

function matches(def, item) {
  if (def.filter === "watch") return true;
  if (def.filter === "past24") {
    const t = Date.parse(item.added_at || "");
    return item.added_by === "daily-automation" && Number.isFinite(t) && now - t >= 0 && now - t <= H24;
  }
  if (def.filter === "best") return (item.match_score || 0) >= taste.automation_rules.best_match_score || (item.tags || []).includes("best");
  if (def.filter === "tags") return (def.tags_any || []).some(tag => (item.tags || []).includes(tag));
  return false;
}

function sortItems(def, items) {
  return [...items].sort((a, b) => {
    if (def.sort === "newest") return Date.parse(b.added_at || 0) - Date.parse(a.added_at || 0) || (b.match_score || 0) - (a.match_score || 0);
    return (b.match_score || 0) - (a.match_score || 0) || Date.parse(b.added_at || 0) - Date.parse(a.added_at || 0) || a.title.localeCompare(b.title);
  });
}

function meta(item) {
  const title = item.canonical_title || item.title;
  const tagText = (item.tags || []).filter(t => t !== "best").join(", ");
  const added = item.added_by === "daily-automation" ? ` • Daily discovery ${item.added_at?.slice(0, 10)}` : "";
  return {
    id: item.imdb_id,
    type: item.type,
    name: title,
    poster: `https://images.metahub.space/poster/medium/${item.imdb_id}/img`,
    posterShape: "poster",
    releaseInfo: String(item.year),
    description: `${item.reason}${item.match_score ? ` • Match ${item.match_score}/100` : ""}${added}${tagText ? ` • ${tagText}` : ""}`
  };
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

const manifestCatalogs = [];
for (const type of ["movie", "series"]) {
  for (const def of config.catalogs) {
    const id = `${def.id}-${type}`;
    const labelType = type === "movie" ? "Movies" : "Series";
    manifestCatalogs.push({ type, id, name: `${def.name} • ${labelType}` });
    const selected = sortItems(def, watch.filter(x => x.type === type && matches(def, x)));
    writeJson(path.join(out, "catalog", type, `${id}.json`), { metas: selected.map(meta) });
    console.log(`${labelType}: ${def.name} -> ${selected.length}`);
  }
}

const manifest = {
  id: config.manifest.id,
  version: config.manifest.version,
  name: config.manifest.name,
  description: config.manifest.description,
  resources: ["catalog"],
  types: ["movie", "series"],
  catalogs: manifestCatalogs,
  idPrefixes: ["tt"]
};
writeJson(path.join(out, "manifest.json"), manifest);
fs.writeFileSync(path.join(out, ".nojekyll"), "", "utf8");

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>WTF Sci-Fi Discovery</title><style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f1117;color:#f5f7ff;margin:0;padding:32px}.card{max-width:820px;margin:auto;background:#191d28;border:1px solid #32394c;border-radius:18px;padding:30px}h1{margin-top:0}p{line-height:1.55;color:#cbd2e6}.btn{display:inline-block;background:#6d5dfc;color:#fff;text-decoration:none;border:0;border-radius:11px;padding:13px 18px;font-weight:700;margin:6px 8px 6px 0;cursor:pointer}code{display:block;background:#0b0d12;border:1px solid #303648;border-radius:8px;padding:10px;word-break:break-all}.small{font-size:.92rem;color:#929bb5}</style></head>
<body><div class="card"><h1>🧬 WTF Sci-Fi Discovery</h1><p>Automated Stremio catalogs for high-concept science fiction, bizarre biology, scientists, impossible systems, time/reality anomalies and unexplained phenomena.</p><p><a id="install" class="btn" href="#">Install in Stremio</a><button id="copy" class="btn">Copy manifest URL</button></p><p>Manifest URL:</p><code id="manifest"></code><p class="small">Catalog contents update automatically when the repository deploys. You do not need to reinstall the addon for ordinary movie/series additions.</p></div>
<script>const u=new URL('manifest.json',location.href).href;document.getElementById('manifest').textContent=u;document.getElementById('install').href=u.replace(/^https:/,'stremio:');document.getElementById('copy').onclick=async()=>{await navigator.clipboard.writeText(u);document.getElementById('copy').textContent='Copied!'};</script></body></html>`;
fs.writeFileSync(path.join(out, "index.html"), html, "utf8");
console.log(`Built ${watch.length} watchlist items into ${out}`);
