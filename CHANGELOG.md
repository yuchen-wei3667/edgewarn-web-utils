# Changelog

All notable changes to `@edgewarn/web-utils` are documented in this file.
Versions are hand-bumped CalVer prereleases (`YYYY.MM.DD-alpha.N`); the
`-alpha.N` suffix is the only compatibility signal for consumers, and
releases are published from git tags (see the release section in
`README.md`).

## Unreleased

- **Breaking:** `NWSAPI` and `WWAAPI` methods are now instance methods. Create
  clients with `createNWSClient({ userAgent, baseUrl })` and
  `createWWAClient({ userAgent, baseUrl })`. `setNwsUserAgent` is removed.
- `createNWSAlertSource` and `createWWAAlertSource` accept injected clients.
- One `DEFAULT_NWS_USER_AGENT` replaces the per-package defaults; the
  `typeof window` User-Agent sniffing is gone.
- `/net` also exports `DEFAULT_NWS_USER_AGENT`, `nwsHeaders` and
  `normalizeUpstreamBaseUrl`.
- Add lint, format, coverage-threshold and test-type checks; remove the
  unwired decoders bench.

## 2026.11.8-alpha.1

- Add the portable `/met` sounding science entry: thermodynamics, parcels,
  wind kinematics, indices, composites and memoised analysis, preserving
  Website numerical results.
- Add `repository` metadata for npm provenance.
- Add the npm publish workflow that ships the package from `main`.

## 2026.11.8-alpha.0

- Consolidated `@edgewarn/core` and `@edgewarn/decoders` into the single
  `@edgewarn/web-utils` package (geometry, time, clients, decoders).
