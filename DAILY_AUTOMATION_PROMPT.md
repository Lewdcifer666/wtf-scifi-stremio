# Daily Sci-Fi Automation Runbook

This file is the canonical runbook for the scheduled `Sci-Fi Discovery` task.
The live scheduled task should fetch this file fresh from the default branch on
every run and execute only the fenced `text` block below. Do not cache this
runbook between runs.

The repository code is authoritative for deterministic state handling. In
particular, raw feedback history, feedback schemas, ownership rules and
personalized-score arithmetic must not be reimplemented ad hoc in the scheduled
model.

```text
PUBLIC CATALOG REPOSITORY:
Lewdcifer666/wtf-scifi-stremio

PRIVATE FEEDBACK REPOSITORY (READ ONLY):
Lewdcifer666/wtf-scifi-feedback

GOAL
Discover a small number of high-confidence Sci-Fi movies/series that fit the current public taste profile, safely append them to the public catalog, and never let personalization complexity block a valid discovery run.

SOURCE OF TRUTH
- Fetch this runbook fresh every run.
- Read the current public `data/taste-profile.json`, `config/catalogs.json`, `data/library.json`, `data/rejections.json`, `data/discovery-log.json`, `scripts/dna-score.mjs`, `scripts/identity.mjs`, `scripts/cinemeta.mjs`, `scripts/validate.mjs`, `scripts/personalized-scores.mjs`, and `scripts/rebuild-personalization.mjs`.
- Enumerate and read every current JSON file under public `data/discoveries/`.
- Read all current JSON feedback events under private `data/feedback/**` when available. The private feedback repository is read-only: never create, update, delete, reorganize, or commit anything there.
- Never expose private free-text feedback in the user-facing report.

EXECUTION BUDGET
Use three phases and protect finalization time.
A. Load current public/private state once.
B. Research candidates efficiently. Stop when the configured daily caps are filled or roughly half the run window has elapsed.
C. Finalize immediately: freeze survivors, perform the fresh state lock, prepare the intended delta, validate, write once, verify deployment, report.
If time is tight, publish fewer candidates rather than weakening research or skipping finalization. Zero findings is valid.

DETERMINISTIC FEEDBACK/PERSONALIZATION CONTRACT
`scripts/rebuild-personalization.mjs` is the authoritative implementation for feedback-chain resolution, supported-schema handling, profile-context ownership, cross-profile universal signals, aggregate learned preferences, and generation of `data/personalized-scores.json`.

The generator supports feedback schemas 1, 2 and 3. Any other schema is opaque for opinion semantics but still participates in supersedes topology. Do not manually reinterpret or override the generator's schema/ownership decisions.

When a runnable local/code-execution environment is available:
1. Build a local snapshot of the CURRENT public source files needed by the generator and a JSON array containing all currently fetched private feedback events.
2. After tentative discoveries are frozen, place the tentative discovery into that local intended-state snapshot so personalization is computed against the state that would exist after the run.
3. Run the current repository script, for example:
   `node scripts/rebuild-personalization.mjs --public-root <local-public-root> --feedback-snapshot <feedback-array.json> --output <personalized-scores.json> --signals-output <automation-signals.json>`
4. Use the local `automation-signals.json` only as aggregate guidance for candidate ranking. Never publish it and never copy private event fields into public data.
5. If candidate-specific execution evidence is intentionally researched, it may be supplied with the script's optional `--execution-evidence` input. Do not invent execution evidence merely to force a personalized entry.

If code execution is unavailable, the feedback snapshot cannot be reconstructed completely, or the deterministic personalization rebuild fails:
- DO NOT hand-calculate or guess personalized scores.
- Leave the existing public `data/personalized-scores.json` unchanged.
- Continue the discovery run using the stable public baseline profile and deterministic baseline DNA scoring.
- The run must not abort the discovery run solely because personalization could not be refreshed. `scripts/personalized-scores.mjs` already treats missing, invalid or stale personalization as optional and safely falls back to baseline scoring.

A successful personalization rebuild may be included in the same public transaction. A failed/skipped personalization rebuild is not itself a reason to suppress a valid discovery/log commit.

PUBLIC IDENTITY / EXCLUSION STATE
Build the public identity set from `data/library.json` plus every current discovery JSON using the exact current repository identity semantics. Reuse that set during research.
Also apply current public rejections, watched exclusions and any hard exclusions from the current taste profile.
Never add a current public identity, watched title, rejected title, or current active feedback identity as a new discovery.

CANDIDATE DISCOVERY
Search the current web broadly across older and newer movies and series. Prefer the profile's actual positive shape: scientific investigation; biology/genetics/ecology/alien organisms; unexplained phenomena; experiments with escalating consequences; impossible systems with discoverable rules; reality/time/memory/consciousness anomalies; and suspense driven by figuring out what is happening.
Strongly penalize straightforward monster escape, generic creature features, psychological/torture horror, slashers, space-opera-first material, superhero/comic-book-universe-first material, action-first military Sci-Fi, repetitive sequels, and slow/withholding stories that do not deliver meaningful discovery. The current taste profile and its guardrails are authoritative.

Use aggregate feedback signals from the deterministic generator when available to refine ordering, but never let learned soft preferences redefine structural hard exclusions.

CONTENT DNA / SCORE
For every tentative accepted title:
- verify the correct IMDb identity and media type;
- research the complete current Content DNA contract from `data/taste-profile.json`;
- use exactly the canonical DNA dimensions/tags and valid ranges;
- action_density and action_intensity must both be researched integers, not inferred from each other;
- cite at least two distinct useful HTTP(S) sources, including identity/basic-premise evidence and substantive whole-runtime/whole-season evidence supporting the stored DNA;
- never invent provenance;
- compute the deterministic baseline DNA score with current repository logic in `scripts/dna-score.mjs` whenever code execution is available; otherwise mirror that current code exactly;
- apply current personalized scoring only when a valid deterministic personalized snapshot is available; otherwise use baseline scoring;
- accept only titles meeting the current `minimum_match_score` and all hard guards. Never lower the threshold to fill a quota.

DISCOVERY RECORD
A new discovery item must use the current repository schema and include at least:
`imdb_id`, `type`, `title`, `year`, `status="watch"`, `preference=null`, `rank=null`, deterministic `match_score`, controlled `tags`, concise `reason`, useful `aliases`, UTC `added_at`, `added_by="daily-automation"`, `discovery_run_id`, `source`, complete `dna`, `dna_confidence`, and valid `dna_tags`.
Do not rewrite `data/library.json` for daily additions. Create one append-only `data/discoveries/<run_id>.json` only when at least one candidate survives.

ABSOLUTE PRE-WRITE STATE LOCK
No public GitHub mutation may occur until this lock passes.
1. Freeze the proposed survivor list and intended run_id.
2. Freshly re-fetch current public `data/library.json`, `data/rejections.json`, `data/discovery-log.json`, and enumerate/re-read all discovery JSON files.
3. Freshly re-fetch every target file/SHA that would be modified, including `data/personalized-scores.json` only if a deterministic refresh is being included.
4. Rebuild the public identity/exclusion sets from those fresh reads and mechanically retest every proposed candidate against public identities, watched exclusions, rejections, active-feedback exclusion rules, and the other proposed candidates.
5. Remove any collision before writing and recompute accepted/rejected/duplicate counts plus `accepted_items` and summary text.
6. Prepare the complete intended public state locally/in memory: discovery file if any, one appended run record in `data/discovery-log.json`, and the refreshed personalized file only if deterministic regeneration succeeded.
7. Validate the complete intended state. If a runnable checkout exists, run `node scripts/validate.mjs` and `npm test` against the intended state. If not, preflight every validator rule affected by this delta from the freshly fetched current validator source.
8. Immediately before the first write, re-fetch the target SHAs and identity/exclusion state once more. If anything material changed, restart this state lock against the new state.
9. Only then perform the public writes. Do not substitute new candidates after this point without restarting the lock.

ZERO-FINDINGS RUN
Zero findings is a valid completed run. Create no discovery file. Append one truthful zero-finding run record to `data/discovery-log.json`. Include a refreshed personalized file only if deterministic regeneration succeeded; otherwise leave personalization unchanged.

TRANSACTION / WRITE ORDER
Prepare all intended file contents before the first mutation. Write only the frozen validated delta. Because GitHub's contents API may require multiple file updates, use current SHAs and do not mutate unrelated files. If a later write in the same run fails, repair/revert only this run's partial delta so the repository returns to the last coherent state.

POST-COMMIT VERIFICATION
After the public commit(s), verify the resulting `Build and Deploy Stremio Catalog` GitHub Actions run.
- If it succeeds, report normally.
- If it fails because of this run's own delta, inspect the actual failing step and repair only this run's new discovery/log/personalization changes. Prefer removing the offending new item over weakening policy or validation.
- If the failure is external or unrelated to this run, do not make speculative repository changes; report that external failure.
- Never weaken or edit `scripts/validate.mjs` merely to make a discovery pass.

REPORT
Report only the accepted new titles with match scores and one-line reasons, or state that zero high-confidence matches were added. If personalization was skipped or preserved because deterministic regeneration was unavailable, mention that briefly without exposing private feedback. Do not print private feedback text, raw aspect ids, private event ids, or private timestamps.

Never modify this scheduled task from inside its own run.
```
