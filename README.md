# WTF Sci-Fi Discovery — Automated Stremio Catalog

A zero-server Stremio catalog system hosted on GitHub Pages. The source library lives in `data/library.json`; GitHub Actions generates and deploys all Stremio catalog JSON automatically.

## What it supports

- Movies **and** series
- Full watchlists
- `Past 24h Findings` for daily automation discoveries
- Best matches
- Biology & Scientists
- Impossible Systems
- Reality, Time & Mind
- Alien / Unknown
- Experiments & Conspiracies
- Mystery & Suspense
- IMDb-ID deduplication
- Automatic metadata resolution through Cinemeta
- Hourly Pages rebuild so the 24-hour catalog expires automatically
- Full automation via a scheduled ChatGPT task
- Semi automation: review recommendations in chat, approve numbers, then update GitHub directly

## First-time GitHub setup

1. Create a **public** GitHub repository named `wtf-scifi-stremio`.
2. Upload **all files and folders from this package to the repository root**. Do not upload the enclosing ZIP folder as an extra level.
3. In the repository go to **Settings → Pages**.
4. Under **Build and deployment → Source**, choose **GitHub Actions**.
5. Open the **Actions** tab. The first push should start `Resolve Library Metadata` and `Build and Deploy Stremio Catalog`.
6. Wait for the workflows to finish. The resolver will fill missing IMDb IDs in `data/library.json` and commit them back automatically.
7. Your Pages URL will be `https://YOUR-GITHUB-USERNAME.github.io/wtf-scifi-stremio/`.
8. Your Stremio manifest will be `https://YOUR-GITHUB-USERNAME.github.io/wtf-scifi-stremio/manifest.json`.
9. Install that manifest in Stremio while logged into the same Stremio account used on the TV.
10. Reopen Stremio on the TV. Ordinary catalog changes do **not** require reinstalling the addon.

## After the repository exists

Tell ChatGPT the repository in `owner/repo` form, for example:

`My repository is DeadlySoul/wtf-scifi-stremio. Set up the daily discovery automation.`

ChatGPT can then read/update the connected GitHub repository directly and create the daily scheduled discovery task.

## Data files

- `data/library.json` — single source of truth for watchlist + seen profile
- `data/taste-profile.json` — stable anti-drift recommendation criteria
- `data/discovery-log.json` — audit log for daily automated runs
- `data/rejections.json` — titles explicitly rejected so automation does not keep suggesting them
- `config/catalogs.json` — predeclared Stremio catalogs

## Important behavior

`Past 24h Findings` includes only titles with `added_by: "daily-automation"` and an `added_at` timestamp less than 24 hours old. Semi-automatic additions go to their normal matching catalogs but do not pollute the automated 24-hour row.

The automation may add zero titles on a weak day. It should never lower quality simply to fill a quota, and it must never silently delete existing watchlist items.
