# Semi-Automation Workflow

## Discovery phase
Ask for recommendations normally, for example:

> Find 20 movies and series with scientists investigating bizarre biological phenomena. Compare against my GitHub Stremio library so you do not show me anything already listed or seen.

ChatGPT should read `data/library.json`, `data/taste-profile.json`, and `data/rejections.json` first, then return a numbered review list. Nothing is changed yet.

## Approval phase
Reply with something like:

> Add 1, 2, 5, 6, 9, 15 and 20.

ChatGPT should then:

1. Re-read the current `data/library.json` to avoid a stale update.
2. Resolve/verify IMDb IDs.
3. Deduplicate.
4. Add only the approved titles with `added_by: "manual-approved"` and the current UTC timestamp.
5. Assign controlled tags and match scores.
6. Update the GitHub file directly and commit it.
7. Do **not** add manual approvals to `Past 24h Findings`; that row is reserved for the scheduled discovery task.
8. GitHub Actions rebuild and deploy automatically.

On the TV, ordinary additions should appear when Stremio refreshes/reloads the remote catalog. No addon reinstall is required because the manifest and catalog IDs remain unchanged.
