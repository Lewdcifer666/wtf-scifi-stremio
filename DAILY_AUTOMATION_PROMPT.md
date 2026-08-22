# Daily Full-Automation Prompt

This scheduled task is configured for `Lewdcifer666/wtf-scifi-stremio`.

```text
Read the current public GitHub repository Lewdcifer666/wtf-scifi-stremio before making any recommendation decisions. Read data/taste-profile.json, data/library.json, data/rejections.json, and data/discovery-log.json.

Search the current web broadly for movies and series that strongly fit the stored taste profile. Candidates may be new releases or older titles that are not yet in the library. Prioritize scientific investigation, biology/genetics/ecology/alien organisms, unexplained phenomena, experiments with escalating consequences, impossible systems with discoverable rules, reality/time/memory/consciousness anomalies, and suspense driven by figuring out what is actually happening.

Stay tightly anchored to the positive and negative examples in data/taste-profile.json. Strongly penalize straightforward monster escape, generic creature features, psychological/torture horror, slashers, space opera, action-first military sci-fi, repetitive sequels, and slow films that withhold information without meaningful discoveries. Do not drift into generic sci-fi or generic horror.

Check data/library.json and data/rejections.json before accepting anything. Deduplicate primarily by IMDb ID and secondarily by normalized title + year + media type. Never re-add a seen title, existing watchlist title, or rejected title.

Score candidates from 0-100 against the taste profile. Only accept candidates scoring at least the minimum_match_score stored in taste-profile.json. Zero findings is completely valid. Never lower the threshold to meet a quota. Add at most the configured daily_movie_max movies and daily_series_max series.

For every accepted title, verify the correct IMDb ID and add a complete item to data/library.json with: imdb_id, type (movie or series), title, year, status="watch", preference=null, rank=null, match_score, controlled tags only, a concise reason explaining the match, useful aliases if needed, added_at as the current UTC ISO-8601 timestamp, added_by="daily-automation", discovery_run_id using today's UTC date plus a short run suffix, and source values describing the research sources used.

Each accepted title must automatically participate in every matching catalog through its tags. The Past 24h catalog is generated automatically from added_by and added_at; do not create a separate duplicate entry for it.

Append one run record to data/discovery-log.json containing run_id, timestamp, counts searched/accepted/rejected/duplicates, accepted IMDb IDs and titles, and a short note about why anything was rejected. If there are zero accepted titles, still append the run record.

Do not silently delete any existing library item. Do not change a user's seen/preference state unless explicitly asked. Do not manually edit generated site files or manifest output. Update only source data files.

Commit the updated source files directly to the default branch of Lewdcifer666/wtf-scifi-stremio with a concise commit message such as "Daily discovery: 3 movies, 1 series — 2026-08-23". The repository's GitHub Actions workflows will resolve metadata, rebuild the Stremio catalogs, and deploy GitHub Pages automatically.

After completing the run, report only the accepted new titles with their match scores and a one-line reason for each. If none qualify, report that zero high-confidence matches were added.
```
