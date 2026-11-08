# MET extraction verification

Source: consumer-app `revision omitted`.
The nine science files and sounding config have no diff from the extraction
plan's earlier `revision omitted` commit. The instruction to implement this plan was taken
as authorization to proceed under its stated Node-service consumer assumption;
no Node service or source adapter was added here.

## Ownership and provenance

`Column` and numerical kernels belong to `/met`. `analyzeSounding` alone owns the
32-entry memo cache. The Website keeps `ColumnSeries`, sources, rendering,
worker plumbing and app limits. `showalter` retains injected lifting, so indices
do not depend on parcels. No runtime dependencies were added.

`validation metadata` records original file SHA-256s, every original function
body hash, adapted file hashes and named mechanical changes. Reversing
`adaptation notes` reconstructs all nine exact originals. These artifacts
preserve the verbatim/adapted checkpoints without creating intermediate broken
commits. The copied numerical bodies are unchanged.

The constant importer audit is in `constant-consumers.json`. D-M2 requires four
constants for plate diagnostics, column sources, model recipes and Skew-T CIN
geometry. Accordingly the entry has **60 functions + 4 constants = 64 runtime
keys**, plus 15 types. No other constants are public.

The plan's `sounding-cache.test.mjs` contains only the Website's `ColumnCache`
tests. Analysis memoisation coverage actually lives in `sounding-properties`;
those cases are ported, with new FIFO-capacity and subarray-offset locks.

## Verification

- Build and all package tests pass; 73 individual MET tests pass with
  `node --test --test-isolation=none packages/met/test/*.test.mjs`.
- Golden SHARPpy/MetPy expectations are unchanged.
- Exact field-by-field comparison against original Website code passes for 42
  analyses: nine golden and five synthetic profiles, each with three motions.
- `npm run lint:pack` and `npm run check:package` pass, including installed
  tarball runtime calls, all 15 type imports and private-path rejection.
- Source adaptation reversal matches all nine original SHA-256 hashes.
- Website baseline and constants-split checkpoint: all 22 requested test files
  pass; TypeScript passes. The test command must include `tests/setup.mjs` to
  resolve the Website's aliases. See `baseline notes` for the pass list.
- Final adoption: all 23 test files pass (the baseline plus parity), and
  TypeScript passes against the extracted tarball. Running without test isolation
  also confirms all 204 individual Website tests pass.
- Website ESLint remains at its baseline 9 errors and 44 warnings; output is
  unchanged. Knip retains its baseline 1 unused dependency, 7 unused exports,
  31 unused exported types and 1 duplicate export. Compatibility shims are
  marked public so retaining old entry points is intentional.
- Website jscpd passes: the same 25 clones / 439 duplicated lines; percentage
  changes from 0.42% to 0.43% because the extracted source is removed.

## Adoption and release

`adoption notes` is the final patch against the pinned Website source.
It includes the dependency and lockfile entry, existing-path shims, the retained
`ColumnSeries`, config boundary and frozen parity cases. It was applied and
verified in an isolated copy; the live sibling Website was not modified.
The separate `intermediate migration notes` records the intermediate Phase 1
checkpoint only: do not apply both patches together.

To adopt before publication, pack this checkout and place
`edgewarn-web-utils-2026.11.8-alpha.0.tgz` in the Website's `vendor/` directory,
apply the adoption patch and run `npm install`. If packing different content,
refresh the lockfile integrity with npm. Re-run the baseline command, TypeScript,
ESLint, Knip and jscpd there. Commit adoption as one unit so reverting that commit
restores the original implementation. After release, use the published version
instead of the local tarball and regenerate the lockfile.

A minor changeset is prepared in `.changeset/sounding-met.md`; no version release
or npm publication has been performed. The existing unchecked memo hash and
shared mutable result references are deliberately preserved and documented;
changing cache correctness is the separate O1 follow-up from the plan.
