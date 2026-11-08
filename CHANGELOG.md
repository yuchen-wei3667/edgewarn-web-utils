# Changelog

All notable changes to `@edgewarn/web-utils` are documented in this file.
Versions are hand-bumped CalVer prereleases (`YYYY.MM.DD-alpha.N`); the
`-alpha.N` suffix is the only compatibility signal for consumers, and
releases are published from git tags (see the release section in
`README.md`).

## 2026.11.8-alpha.2

- Bump release counter after the `2026.11.8-alpha.1` package build fix.

## 2026.11.8-alpha.1

- Add the portable `/met` sounding science entry: thermodynamics, parcels,
  wind kinematics, indices, composites and memoised analysis, preserving
  Website numerical results.
- Add `repository` metadata for npm provenance.
- Add the npm publish workflow that ships the package from `main`.

## 2026.11.8-alpha.0

- Consolidated `@edgewarn/core` and `@edgewarn/decoders` into the single
  `@edgewarn/web-utils` package (geometry, time, clients, decoders).
