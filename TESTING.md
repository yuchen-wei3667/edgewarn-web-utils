# Testing

## Running tests

- `npm test` — build, then run every `packages/*/test/**/*.test.mjs` file
  (glob-derived; new subdirectories are picked up automatically).
- `npm run test:coverage` — same suite with Node's built-in coverage report.
- `npm run test:time` — run the time-sensitive tests
  (`packages/*/test/*time*.test.mjs` plus
  `packages/alerts/test/alert-format.test.mjs`) once per time zone:
  UTC, America/New_York, America/Los_Angeles, Asia/Tokyo. The zone list and
  the discovery glob live in `scripts/test-time.mjs`.
- `npm run test:types` — build, then verify every test's imports resolve
  against the built package types (see “Type-checking tests” below).
- `npm run lint` — ESLint over sources, tests and scripts.
- `npm run format` / `npm run format:check` — Prettier over sources and
  scripts. Tests are intentionally excluded from the formatter: several are
  single-line-per-assertion by design and formatting them would only add
  churn.

## Type-checking tests

Tests are `.mjs` files. `tsconfig.check.json` (`allowJs` + `checkJs`,
non-strict) runs `tsc` over all of them against the built package types.
`npm run test:types` gates on module-resolution errors — TS2307 (module not
found) and TS2305 (no such export) — because those mean a test imports
something that no longer exists.

Full structural `checkJs` (strict) is a known follow-up: today's run reports
~225 findings, almost all object-literal fixtures that omit optional wire
fields the runtime tolerates. Gating on them now would require weakening
library types or contorting fixtures, so they are surfaced in the script
output but not enforced.

## Golden fixtures

| Fixture | Consumed by | Regeneration |
|---|---|---|
| `packages/met/test/fixtures/golden.json` | `packages/met/test/sounding-golden.test.mjs` | Regenerate profiles/inputs with the SHARPpy+MetPy harness that produced it (the script lives outside this repo), then re-derive `sharppy`/`metpy` fields per the tolerance table at the top of the test. Never hand-edit reference values. |
| `packages/alerts/test/fixtures/expected.json` | `packages/alerts/test/alert-lock-evaluation.test.mjs` (via `packages/alerts/test/helpers/evaluate.mjs`) | Run `evaluate(alerts, fixtures)` over the fixture alerts and write the result verbatim. Re-review `diff` output by hand before committing. |
| `packages/decoders/test/fixtures/models/reference.json` | `packages/decoders/test/models/*.test.mjs` | Re-run the model decoders against the `.grib2` fixtures in the same directory and record decoded values; hand-editing is not acceptable. |

## Benchmarks

`packages/decoders/bench/` was removed (audit item 3): it had no npm script,
`results.json` baked in the machine platform with `sourceCommit: "revision
omitted"`, and `fixtures.mjs` referenced a `src/utils` layout from another
repo — dead weight that looked like it was measuring something. If decoder
performance tracking is needed again, add a small wired-up script that
measures `dist/` output and records the git commit.
