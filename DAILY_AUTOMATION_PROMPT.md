# Daily Full-Automation Prompt

This scheduled task is configured for `Lewdcifer666/wtf-scifi-stremio`.

```text
Read the current public GitHub repository Lewdcifer666/wtf-scifi-stremio before making any recommendation decisions. Read data/taste-profile.json, data/library.json, data/rejections.json, data/discovery-log.json, and the existing JSON files under data/discoveries/.

Search the current web broadly for movies and series that strongly fit the stored taste profile. Candidates may be new releases or older titles that are not yet in the library. Prioritize scientific investigation, biology/genetics/ecology/alien organisms, unexplained phenomena, experiments with escalating consequences, impossible systems with discoverable rules, reality/time/memory/consciousness anomalies, and suspense driven by figuring out what is actually happening.

Stay tightly anchored to the positive and negative examples in data/taste-profile.json. Strongly penalize straightforward monster escape, generic creature features, psychological/torture horror, slashers, space opera, action-first military sci-fi, repetitive sequels, and slow films that withhold information without meaningful discoveries. Do not drift into generic sci-fi or generic horror.

Check data/library.json, every existing data/discoveries/*.json file, and data/rejections.json before accepting anything. Deduplicate primarily by IMDb ID and secondarily by normalized title + year + media type. Never re-add a seen title, existing watchlist title, previously discovered title, or rejected title.

Score candidates from 0-100 against the taste profile. Only accept candidates scoring at least the minimum_match_score stored in taste-profile.json. Zero findings is completely valid. Never lower the threshold to meet a quota. Add at most the configured daily_movie_max movies and daily_series_max series.

For every accepted title, verify the correct IMDb ID and prepare a complete item with: imdb_id, type (movie or series), title, year, status="watch", preference=null, rank=null, match_score, controlled tags only, a concise reason explaining the match, useful aliases if needed, added_at as the current UTC ISO-8601 timestamp, added_by="daily-automation", discovery_run_id using today's UTC date plus a short run suffix, and source describing the research source used.

Do NOT rewrite data/library.json for daily additions. Instead create one new append-only file at data/discoveries/<run_id>.json with schema_version=1, run_id, timestamp, and an items array containing the accepted titles. The Stremio site builder automatically merges these discovery files with the permanent seed library and deduplicates them.

Each accepted title automatically participates in every matching catalog through its tags. The Past 24h catalog is generated from added_by and added_at; do not create a separate duplicate entry for it.

Append one run record to data/discovery-log.json containing run_id, timestamp, counts searched/accepted/rejected/duplicates, accepted IMDb IDs/titles/scores, and a short rejection summary. If there are zero accepted titles, still append the run record but do not create an empty discovery file unless useful for auditing.

Do not silently delete any existing library or discovery item. Do not change a user's seen/preference state unless explicitly asked. Do not manually edit generated site files or manifest output. Update only source data files.

Commit the source changes directly to the default branch of Lewdcifer666/wtf-scifi-stremio with concise commit messages. The repository's GitHub Actions workflow will validate, rebuild the Stremio catalogs, and deploy GitHub Pages automatically.

After completing the run, report only the accepted new titles with their match scores and a one-line reason for each. If none qualify, report that zero high-confidence matches were added.
```
