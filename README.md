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
- Research via the existing scheduled ChatGPT task, with deterministic GitHub publication after cutover
- Validated pull requests for reviewed catalog changes

## First-time GitHub setup

1. Create a **public** GitHub repository named `wtf-scifi-stremio`.
2. Upload **all files and folders from this package to the repository root**. Do not upload the enclosing ZIP folder as an extra level.
3. In the repository go to **Settings → Pages**.
4. Under **Build and deployment → Source**, choose **GitHub Actions**.
5. Open the **Actions** tab. The first push should start `Resolve Library Metadata` and `Build and Deploy Stremio Catalog`.
6. Follow [publication cutover](docs/publication-cutover.md) before enabling automated publication. The resolver proposes fully validated metadata PRs after activation.
7. Your Pages URL will be `https://YOUR-GITHUB-USERNAME.github.io/wtf-scifi-stremio/`.
8. Your Stremio manifest will be `https://YOUR-GITHUB-USERNAME.github.io/wtf-scifi-stremio/manifest.json`.
9. Install that manifest in Stremio while logged into the same Stremio account used on the TV.
10. Reopen Stremio on the TV. Ordinary catalog changes do **not** require reinstalling the addon.

## Existing scheduled task

Keep the existing 08:00 Europe/Berlin task and rotator unchanged until the
coordinated cutover. Its replacement instructions are in
[publication cutover](docs/publication-cutover.md); do not create a duplicate task.

## Data files

- `data/library.json` — single source of truth for watchlist + seen profile
- `data/taste-profile.json` — stable anti-drift recommendation criteria
- `data/discovery-log.json` — frozen legacy history
- `data/run-logs/*.json` — immutable daily run records
- `research-inbox/*.json` on research branches — persisted research packets
- `data/rejections.json` — titles explicitly rejected so automation does not keep suggesting them
- `config/catalogs.json` — predeclared Stremio catalogs

## Important behavior

`Past 24h Findings` includes only titles with `added_by: "daily-automation"` and an `added_at` timestamp less than 24 hours old. Semi-automatic additions go to their normal matching catalogs but do not pollute the automated 24-hour row.

The automation may add zero titles on a weak day. It should never lower quality simply to fill a quota, and it must never silently delete existing watchlist items.

## Preserved deterministic personalization rebuilder

This manual interface remains available for the required learning migration.
It is not called by research or publication. Learning remains dormant until its
separate audited cutover; the command below documents the existing interface.

Stable baseline DNA scores remain the default. An expired snapshot is never made
active by changing its timestamp. Rebuilding requires a local checkout of the
complete feedback repository, with `HEAD` equal to the current default-branch
`HEAD` advertised by `origin`. The checkout must be clean, including untracked
and ignored files. The script reads it only; it does not fetch, update or write
the feedback repository.

From the public repository, use the actual repository-relative directory that
contains **all** feedback event JSON files, including nested, superseded and
retracted events:

```sh
node scripts/rebuild-personalization.mjs --feedback-repo /path/to/feedback-checkout --feedback-dir events --output data/personalized-scores.json
```

Replace `events` with the complete event directory in that repository. Selecting
one subdirectory is rejected when other event records exist elsewhere in the
pinned source tree. Each selected JSON file must contain one supported feedback
event. Unknown schemas, malformed events, dangling corrections, cycles,
unreadable source files and an unavailable or changed origin abort the rebuild.
The existing output remains byte-for-byte unchanged on failure. Baseline scoring
continues while the saved snapshot is absent, stale, invalid or inapplicable.

`--execution-evidence /path/to/evidence.json` supplies optional researched
execution evidence. `--signals-output /path/to/private-output.json` is optional;
keep that feedback-derived diagnostic output private. All outputs must be outside
the read-only feedback checkout. The sanitized public snapshot contains only its
schema version, generation time and per-title score pairs. The verified source
revision and event count are reported to stderr for the run record.

The CLI rejects arbitrary `--feedback-snapshot` inputs and `--generated-at`
overrides. Its timestamp is created only after rebuilding from the verified
source; the source is checked again immediately before output replacement. The
exported calculation function accepts synthetic arrays and fixed times for tests,
but it does not publish files. Publication proceeds with baseline scoring while
personalization is dormant; it never renews an expired snapshot.

## Reliability remake preparation

The research-packet publication architecture is prepared but dormant until a
coordinated cutover after the Thriller pilot gate. See
[publication cutover](docs/publication-cutover.md). The scheduled ChatGPT task
will stage only research packets; trusted-main GitHub workflows will validate,
score, reconcile immutable attempts and publish through protected App-owned
PRs. Pages keeps its existing hourly schedule and emits a deployment receipt.

Existing history, genre policy, catalog identities and dormant personalization
are preserved. Automatic private feedback interpretation and deterministic
learning remain mandatory later work; publication is not migration completion.
