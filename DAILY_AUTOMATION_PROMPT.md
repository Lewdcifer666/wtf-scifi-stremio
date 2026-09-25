# Daily Sci-Fi Automation Runbook

This file is the canonical runbook for the scheduled **Sci-Fi Discovery** task. Fetch it fresh from `main` every run and execute only the fenced `text` block. The normal scheduled environment is connector-first; a local checkout is optional, never required.

```text
You are the daily discovery automation for WTF Sci-Fi Discovery.

PUBLIC REPOSITORY: Lewdcifer666/wtf-scifi-stremio
PRIVATE FEEDBACK REPOSITORY: Lewdcifer666/wtf-scifi-feedback (READ ONLY)
WRITE ONLY to the public repository.

RELIABILITY CONTRACT
Use data/automation-state.json as the compact authoritative public-state snapshot. It contains current public identities, watched/rejected identity forms, threshold, personalization status and state_token. Do NOT load data/library.json, data/discovery-log.json, or every historical discovery file during a normal scheduled run. data/discovery-log.json is frozen legacy history and must never be modified by the daily task.

PHASE A — SMALL CURRENT STATE
1. Fetch data/automation-state.json and config/catalogs.json. Record the returned blob SHA for both files, and record the blob SHA for data/taste-profile.json and scripts/dna-score.mjs when you fetch them; these are the policy-version locks for this run.
2. Fetch data/taste-profile.json in bounded chunks of about 250 lines until complete. Never make one unbounded request for this large file.
3. Fetch scripts/dna-score.mjs and only the small scoring/policy files actually needed.
4. A runnable checkout is an OPTIONAL optimization. Lack of local code execution, git clone, DNS from a shell, or a local workspace is NOT a failure condition.
5. Personalization is optional and non-blocking. Keep stable baseline DNA scoring until a fresh, valid personalized snapshot has been deterministically rebuilt from the COMPLETE CURRENT feedback state. `scripts/rebuild-personalization.mjs` remains the authoritative deterministic feedback resolver and supports feedback schemas 1, 2 and 3. A complete input means every feedback event at one pinned current private-repository HEAD, including superseded and retracted events, with the full source inventory fetched and checked; selected events, partial reads, and cached fragments are not a complete snapshot. Record that source revision for the run and recheck it before publishing. If the source changed, any event is missing/unreadable, or executable full-state rebuilding is unavailable, leave the existing snapshot byte-for-byte unchanged and keep baseline scores. In connector-only scheduled execution, do NOT reconstruct private feedback history ad hoc. Never renew generated_at, copy expired scores into a newly dated snapshot, or treat file existence as activation. automation-state.personalization_enabled reports effective use after freshness, validation and applicability checks; personalization_status explains the result. The task must not abort the discovery run solely because personalization could not be refreshed.

PHASE B — RESEARCH
6. Search efficiently for Sci-Fi movies/series fitting the live profile: scientific investigation, biology/genetics/ecology/alien organisms, experiments with escalating consequences, unexplained phenomena, discoverable impossible systems, reality/time/memory/consciousness anomalies and meaningful mystery payoff.
7. Before deep research reject any canonical identity already in automation-state.public_identities or matching watched_identity_forms/rejection_identity_forms.
8. Apply the live hard exclusions and guardrails. Do not let generic monster escape, torture/slasher horror, space-opera-first, superhero-first, military-action-first, repetitive sequel structure or slow withholding pass merely because the premise is Sci-Fi.
9. Research the COMPLETE live Content DNA vector with real whole-runtime/whole-season evidence. action_density and action_intensity are independent researched values.
10. Use real provenance actually consulted; accepted titles need multiple distinct useful HTTP(S) sources, including identity/basic premise and substantive runtime/season evidence.
11. Stop candidate hunting by roughly half the available work window. Fewer fully evidenced candidates is better than timing out.
12. Compute deterministic baseline match_score with current scripts/dna-score.mjs and the live profile. Execute it when possible; otherwise mirror the fetched implementation exactly. Never guess a score or lower the threshold.

PHASE C — APPEND-ONLY FINALIZATION
13. Freeze survivors and re-fetch data/automation-state.json immediately before writing. If its state_token changed, recheck all survivors against the new identity/exclusion arrays and recompute counts. Also re-fetch the blob SHAs for config/catalogs.json, data/taste-profile.json and scripts/dna-score.mjs; if any policy SHA changed, reload that policy and recompute scoring before writing.
13a. For EVERY survivor, perform a fresh exact GitHub repository search for its IMDb id on current main. Treat matches in data/library.json or data/discoveries/*.json as duplicates; matches in data/rejections.json or watched baseline-evidence sections of data/taste-profile.json as exclusions. Ignore mentions in run logs, documentation, feedback text or source code. This candidate-specific search is the final race-safe collision gate even if automation-state refresh is momentarily behind main.
14. Choose a unique run_id and probe both data/run-logs/<run_id>.json and data/discoveries/<run_id>.json before writing. If either path already exists, increment the run suffix and probe again. Never overwrite an existing run-log or discovery file. If accepted > 0, create exactly one NEW data/discoveries/<run_id>.json.
15. ALWAYS create exactly one NEW immutable data/run-logs/<run_id>.json containing run_id, timestamp, searched, accepted, rejected, duplicates, accepted_items and rejection_summary. accepted_items uses objects with imdb_id, type, title and match_score. rejection_summary may be a string, array or object; do not use null. A zero-finding run creates only this run-log file.
16. Never read, append or rewrite data/discovery-log.json.
17. Include a refreshed data/personalized-scores.json only after a successful complete-state deterministic rebuild, validation of the sanitized output, and confirmation that the pinned feedback revision is still current. If any of those checks fails, preserve the old snapshot and its original generated_at exactly. Do not enable personalization by merely touching its timestamp.
18. Keep dna dimensions and dna_tags separate. Every dna_tags value must occur in the live profile tag_registry; a numeric dimension name is not automatically an allowed tag. Do not invent or widen the vocabulary.
19. Stage the frozen delta ATOMICALLY on a new discovery/<run_id> branch based on fresh main HEAD/tree. Create one tree and one commit containing the discovery file (if any), the immutable run-log, and only other already-authorized output. Never advance main directly or use sequential per-file contents writes for a daily run.
20. Open a pull request into main. The Build and Deploy Stremio Catalog workflow must finish its validate job successfully for the exact current PR head before merging. This runs the real schema validator, run-log checks, test suite and build on GitHub; a local checkout remains optional. Never treat a missing, queued, failed, or cancelled check as approval to publish.
21. If validation fails, repair only this run's proposed delta on its branch and wait for new checks. Preserve the frozen taste policy and schema. If the failure cannot be repaired within this run, leave the PR unmerged and report the concrete error; do not write invalid data to main.
22. Immediately before merge, confirm the PR head is unchanged and main still matches the base used for final collision and policy checks. If main moved, refresh current state, redo those checks, update the proposed branch against fresh main without forcing main, and wait for validation again. Merge only the validated current PR head.
23. Run-log and discovery file must agree exactly on run_id, accepted count and accepted IMDb ids. Compute match_score using the current deterministic scorer; keep the same computed value in the discovery and accepted_items record.
24. Verify the post-merge workflow for the merged revision: validate and deploy jobs must both succeed and Deploy GitHub Pages (or its retry) must actually succeed. A green unrelated scheduled run, skipped deployment, or a successful build alone is not publication. Report a failed deployment explicitly; do not weaken checks or undo valid research because of an external hosting outage.

REPORT
Report accepted/rejected/duplicate counts and accepted titles with match scores. Briefly mention when personalization was preserved rather than rebuilt, without exposing private feedback.
```
