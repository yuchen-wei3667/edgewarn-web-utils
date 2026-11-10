# Changelog

All notable changes to `@edgewarn/web-utils` are documented in this file.
Versions are hand-bumped CalVer prereleases (`YYYY.MM.DD-alpha.N`); the
`-alpha.N` suffix is the only compatibility signal for consumers, and
releases are published from git tags (see the release section in
`README.md`).

## Unreleased

- Add `/colormap`: `Colormap` types, `mapValueToRgba`, `createColormapTextureData`, `findColormapByKey`, `normalizeColormapKey`, `isValidRgb`, `extractColormaps` and legend helpers.
- Add `/geo` `distanceMeters` and solar helpers (`solarPosition`, `declinationDeg`, `dayOfYear`, `pathFraction`, `oppositeAltitude`).
- Add `/time` `nearestFrameWindow` and `framesForTimeline`.
- Add `/net` `parseS3Listing`, `listS3Pages` and `SharedTask`.
- Add `/alerts` discussion expiry helpers with an injectable clock for `createExpiryWatch`.
- Add `/met` wind-speed unit conversion and `steadmanApparentTemperature`.
- Add `/grib2` `packedOf` and `physicalOf`.

## 2026.11.8-alpha.3

- Export float16 conversion and level reduction helpers from `/grib2`.
- Export transport, allowed-feed URL and payload normalization helpers from `/net`.
- Export the GOES `inflate` helper alongside `InflateError`.
- Allow NWS and WWA clients to omit the browser-controlled User-Agent header with `userAgent: null`.

## 2026.11.8-alpha.2

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
- `@types/geojson` is now a caret range (`^7946.0.16`).
- Add `api-surface.json` and `npm run api:check` / `api:update`: CI fails when
  the public runtime exports change without a reviewed snapshot update.
- Declaration maps are no longer generated (the sources are not shipped).
- The `alerts` presentation exports (`warningCopy`, `heroTitleForAlert`,
  `getEventColors`, `selectAlertsToSound`, dismissals, dashboard significance)
  are tagged `@experimental` and may change in any release.
- Docs no longer refer to an external Website; the stale met consumer map is
  removed.

## 2026.11.8-alpha.1

- Add the portable `/met` sounding science entry: thermodynamics, parcels,
  wind kinematics, indices, composites and memoised analysis, preserving
  Website numerical results.
- Add `repository` metadata for npm provenance.
- Add the npm publish workflow that ships the package from `main`.

## 2026.11.8-alpha.0

- Consolidated `@edgewarn/core` and `@edgewarn/decoders` into the single
  `@edgewarn/web-utils` package (geometry, time, clients, decoders).
