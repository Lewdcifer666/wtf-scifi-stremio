# Historical test archive

These suites were already excluded from the active npm test command before the
reliability remake. Their original bytes are retained for audit. Several assert
obsolete prompt-operated publication and mandatory personalized-snapshot refresh,
which contradict the current research-only and explicit learning-cutover policy.
They are not acceptance evidence for the remake. Existing active suites remain
active, alongside every current shared engine suite and new publication tests.

Original active command:

```sh
node --check scripts/rebuild-personalization.mjs && node test/personalization-rebuild.test.mjs && node test/personalization-source.test.mjs && node test/automation-contract.test.mjs && node scripts/validate.mjs && node test/engine-checksum.test.mjs && node test/cinemeta-resolution.test.mjs && node test/duplicate-repair-summary.test.mjs && node test/personalization-state.test.mjs && node test/build-state.test.mjs && node test/automation-integrity.test.mjs
```

Archived suites:

- acceptance.test.mjs
- action-density.test.mjs
- catalog-build.test.mjs
- direct-tone.test.mjs
- dna-score.test.mjs
- duplicate-identity.test.mjs
- feedback-ownership.test.mjs
- inertness.test.mjs
- prompt-contract.test.mjs
- source-provenance.test.mjs
- validate-profile.test.mjs

Run every archived suite with `npm run test:legacy`. Select one or more with
`npm run test:legacy -- <name.test.mjs> [another.test.mjs]`. The equivalent direct
entry point is `node test/legacy/run.mjs`, with the same optional filenames.
The helper restores each old test location in a disposable checkout so original
relative imports remain usable. It prints each selected suite and returns a
nonzero exit status if any suite fails. The normal `npm test` command does not
run these archived suites. Failures against obsolete behavior are expected;
do not weaken current policy to satisfy a historical prompt assertion.
