const CINEMETA = "https://v3-cinemeta.strem.io";

export function normalizeTitle(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[²]/g, "2")
    .replace(/&/g, "and")
    .replace(/[^a-zA-Z0-9+]+/g, " ")
    .trim()
    .toLowerCase();
}

export function yearFromMeta(meta) {
  const text = String(meta?.releaseInfo || meta?.released || "");
  const match = text.match(/(19|20)\d{2}/);
  return match ? Number(match[0]) : null;
}

function titleMatches(name, item) {
  const wanted = [item.title, ...(item.aliases || [])].map(normalizeTitle);
  return wanted.includes(normalizeTitle(name));
}

function chooseBest(metas, item) {
  const imdb = metas.filter(m => typeof m.id === "string" && /^tt\d+$/.test(m.id));
  if (!imdb.length) return null;

  return (
    imdb.find(m => titleMatches(m.name, item) && yearFromMeta(m) === item.year) ||
    imdb.find(m => titleMatches(m.name, item) && yearFromMeta(m) && Math.abs(yearFromMeta(m) - item.year) <= 1) ||
    imdb.find(m => titleMatches(m.name, item)) ||
    imdb.find(m => yearFromMeta(m) === item.year) ||
    null
  );
}

async function fetchJson(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "WTF-SciFi-Stremio-Automation/2.0" }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveItem(item) {
  if (item.imdb_id && /^tt\d+$/.test(item.imdb_id)) return item;

  const type = item.type === "series" ? "series" : "movie";
  const queries = [item.title, ...(item.aliases || [])];
  let lastError = null;

  for (const query of queries) {
    try {
      const url = `${CINEMETA}/catalog/${type}/top/search=${encodeURIComponent(query)}.json`;
      const json = await fetchJson(url);
      const chosen = chooseBest(Array.isArray(json.metas) ? json.metas : [], item);
      if (!chosen) continue;
      return {
        ...item,
        imdb_id: chosen.id,
        canonical_title: chosen.name || item.title,
        resolved_year: yearFromMeta(chosen) || item.year,
        resolved_at: new Date().toISOString()
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`${item.type}:${item.title} (${item.year}) could not be resolved${lastError ? ` — ${lastError.message}` : ""}`);
}
