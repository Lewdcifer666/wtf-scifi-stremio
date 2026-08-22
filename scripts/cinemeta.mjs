const CINEMETA = "https://v3-cinemeta.strem.io";

const REQUEST_TIMEOUT_MS = 30000;
const MAX_ATTEMPTS = 5;


/*
 * Verified fallback IDs for seed/reference titles that already exist
 * in our initial library.
 *
 * These are primarily here so a temporary Cinemeta outage cannot
 * prevent the initial catalog from being built.
 *
 * Future recommendations should normally arrive with an IMDb ID
 * already supplied by the recommendation/automation process.
 */
const KNOWN_IMDB_IDS = new Map([
  ["movie:i origins:2014", "tt2884206"],
  ["movie:time lapse:2014", "tt2669336"],
  ["movie:identity:2003", "tt0309698"],
  ["movie:old:2021", "tt10954652"],
  ["movie:radius:2017", "tt6097798"],
  ["movie:the forgotten:2004", "tt0356618"],
  ["movie:coherence:2013", "tt2866360"],
  ["movie:no one will save you:2023", "tt14509110"],
  ["movie:knowing:2009", "tt0448011"],
  ["movie:arq:2016", "tt5640450"],
  ["movie:in the shadow of the moon:2019", "tt8110640"],
  ["movie:splice:2009", "tt1017460"],
  ["movie:transcendence:2014", "tt2209764"],
  ["movie:the titan:2018", "tt4986098"],
  ["movie:annihilation:2018", "tt2798920"],
  ["movie:lucy:2014", "tt2872732"],
  ["movie:cube:1997", "tt0123755"],
  ["series:fringe:2008", "tt1119644"]
]);


function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


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
  const text = String(
    meta?.releaseInfo ||
    meta?.released ||
    ""
  );

  const match = text.match(
    /(19|20)\d{2}/
  );

  return match
    ? Number(match[0])
    : null;
}


function itemKey(item) {
  const type =
    item.type === "series"
      ? "series"
      : "movie";

  return (
    `${type}:` +
    `${normalizeTitle(item.title)}:` +
    `${item.year}`
  );
}


function titleMatches(name, item) {
  const wanted = [
    item.title,
    ...(item.aliases || [])
  ].map(normalizeTitle);

  return wanted.includes(
    normalizeTitle(name)
  );
}


function chooseBest(metas, item) {
  const imdb = metas.filter(
    meta =>
      typeof meta.id === "string" &&
      /^tt\d+$/.test(meta.id)
  );

  if (!imdb.length) {
    return null;
  }


  /*
   * Best possible match:
   * exact normalized title + exact year.
   */
  const exact =
    imdb.find(
      meta =>
        titleMatches(meta.name, item) &&
        yearFromMeta(meta) === item.year
    );

  if (exact) {
    return exact;
  }


  /*
   * Some databases disagree by one year because of:
   *
   * festival premiere
   * theatrical release
   * streaming release
   */
  const closeYear =
    imdb.find(
      meta =>
        titleMatches(meta.name, item) &&
        yearFromMeta(meta) &&
        Math.abs(
          yearFromMeta(meta) -
          item.year
        ) <= 1
    );

  if (closeYear) {
    return closeYear;
  }


  /*
   * Exact title without usable year information.
   */
  const exactTitle =
    imdb.find(
      meta =>
        titleMatches(
          meta.name,
          item
        )
    );

  if (exactTitle) {
    return exactTitle;
  }


  /*
   * Final fallback:
   * exact requested year.
   */
  return (
    imdb.find(
      meta =>
        yearFromMeta(meta) ===
        item.year
    ) ||
    null
  );
}


function shouldRetryStatus(status) {
  return (
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  );
}


function retryDelay(attempt) {
  /*
   * 1 -> 1000 ms
   * 2 -> 2000 ms
   * 3 -> 4000 ms
   * 4 -> 8000 ms
   * 5 -> 8000 ms max
   */
  return Math.min(
    1000 * (2 ** (attempt - 1)),
    8000
  );
}


async function fetchJsonOnce(
  url,
  timeoutMs
) {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      timeoutMs
    );

  try {
    const response =
      await fetch(
        url,
        {
          signal:
            controller.signal,

          headers: {
            "User-Agent":
              "WTF-SciFi-Stremio-Automation/2.1",

            "Accept":
              "application/json"
          }
        }
      );


    if (!response.ok) {
      const error =
        new Error(
          `HTTP ${response.status}`
        );

      error.status =
        response.status;

      throw error;
    }


    return await response.json();

  } finally {
    clearTimeout(timer);
  }
}


async function fetchJson(
  url,
  timeoutMs = REQUEST_TIMEOUT_MS
) {
  let lastError = null;


  for (
    let attempt = 1;
    attempt <= MAX_ATTEMPTS;
    attempt++
  ) {
    try {
      return await fetchJsonOnce(
        url,
        timeoutMs
      );

    } catch (error) {
      lastError = error;

      const aborted =
        error?.name ===
        "AbortError";

      const retryableHttp =
        typeof error?.status ===
          "number" &&
        shouldRetryStatus(
          error.status
        );

      const networkFailure =
        error instanceof TypeError;


      const retryable =
        aborted ||
        retryableHttp ||
        networkFailure;


      if (
        !retryable ||
        attempt ===
          MAX_ATTEMPTS
      ) {
        break;
      }


      const delay =
        retryDelay(attempt);


      console.warn(
        `Cinemeta request failed ` +
        `(attempt ${attempt}/${MAX_ATTEMPTS}): ` +
        `${error.message}. ` +
        `Retrying in ${delay} ms...`
      );


      await sleep(delay);
    }
  }


  throw lastError ||
    new Error(
      "Unknown Cinemeta request failure"
    );
}


function resolveFromKnownIds(item) {
  const id =
    KNOWN_IMDB_IDS.get(
      itemKey(item)
    );


  if (!id) {
    return null;
  }


  return {
    ...item,

    imdb_id:
      id,

    canonical_title:
      item.title,

    resolved_year:
      item.year,

    resolved_at:
      new Date().toISOString(),

    resolved_via:
      "known-id-fallback"
  };
}


export async function resolveItem(item) {
  /*
   * Already resolved.
   */
  if (
    item.imdb_id &&
    /^tt\d+$/.test(
      item.imdb_id
    )
  ) {
    return item;
  }


  /*
   * First use our verified fallback table.
   *
   * This prevents temporary Cinemeta failures from
   * blocking known seed/reference titles.
   */
  const known =
    resolveFromKnownIds(item);


  if (known) {
    return known;
  }


  const type =
    item.type === "series"
      ? "series"
      : "movie";


  const queries = [
    item.title,
    ...(item.aliases || [])
  ];


  let lastError = null;


  for (const query of queries) {
    try {
      const url =
        `${CINEMETA}` +
        `/catalog/${type}` +
        `/top/search=` +
        `${encodeURIComponent(query)}` +
        `.json`;


      const json =
        await fetchJson(url);


      const chosen =
        chooseBest(
          Array.isArray(json.metas)
            ? json.metas
            : [],
          item
        );


      if (!chosen) {
        continue;
      }


      return {
        ...item,

        imdb_id:
          chosen.id,

        canonical_title:
          chosen.name ||
          item.title,

        resolved_year:
          yearFromMeta(chosen) ||
          item.year,

        resolved_at:
          new Date().toISOString(),

        resolved_via:
          "cinemeta"
      };

    } catch (error) {
      lastError = error;


      console.warn(
        `Cinemeta query failed for ` +
        `"${query}": ` +
        `${error.message}`
      );
    }
  }


  throw new Error(
    `${item.type}:` +
    `${item.title} ` +
    `(${item.year}) ` +
    `could not be resolved` +
    (
      lastError
        ? ` — ${lastError.message}`
        : ""
    )
  );
}
