# ADR-001: Next modules to move from EdgeWARN-Website into @edgewarn/web-utils

**Status:** Proposed
**Date:** 2026-11-08
**Deciders:** Package maintainer

## Context

`@edgewarn/web-utils` is one ESM package with zero runtime dependencies and subpath exports. It is built from the internal `core`, `alerts`, `decoders` and `met` source boundaries.

`../EdgeWARN-Website` holds about 27k lines in `src/utils` and about 4.3k in `src/config/models`.

The website has no import of `@edgewarn/web-utils` anywhere. Everything the package already provides is still duplicated in `src/utils`, and the copies have started to drift. `alert-priority.ts`, `geo/polygon.ts` and the sounding thermo code already differ from their package versions.

Method: directory sizes and a grep for react, next, maplibre, `window` and `document` imports. "Pure" below means no such imports were found. Files were not read one by one.

## Decision

Migrate the website onto the package for everything already packaged. Then move the Tier 1 modules below into the package. Defer Tier 2. Never move Tier 3.

## Findings

### A. Already packaged, still duplicated in the website

These need migration, not new packaging.

| Website path | Package module |
| --- | --- |
| `src/utils/alerts/*` | `alerts` |
| `src/utils/geo/*` | `core/geo` |
| `src/utils/goes/*` | `decoders/goes` |
| `src/utils/nexrad/decoder`, `level3` | `decoders/nexrad` |
| `src/utils/mrms/grib2` | `decoders/grib2/mrms` |
| `src/utils/models` (`idx`, `half`, `grib2`, `levelGrid`, `addons`) | `decoders/grib2/models` |
| `src/utils/sounding` (analysis) | `met` |
| `src/utils/api/edgewarn`, `nws-api` | `core/net` |

### B. Tier 1: pure, large, clear home

| Website path | About LOC | Target |
| --- | --- | --- |
| `utils/models/projection/*` (lambert, mercator, polar stereo, rotated latlon, bounds) | 600 | `geo/projection` or `grib2/projection` |
| `config/models/**` plus `utils/models/{registry,catalog,datasets,modelFamily,modelGroups}` | 6,000 | new `models` entry. Largest win. |
| `utils/models/compare/**` (expression parser, VM, regrid, align) | 1,500 | `models` |
| `utils/models/{ensemble*,tracks,trajectory,winds,isobars}`, `export/{plan,projection,compose,settings}` | 2,000 | `models` |
| `utils/models/sources/*` (range fetcher, grib2Index, probe) | 600 | `models`, only if the fetcher stays dependency-free |
| `utils/mrms/{catalog,listing,sentinels,lightning,gzCache}` | 1,000 | `decoders/mrms` or new `mrms` |
| `utils/mrms/volume/*` | 700 | same |
| `utils/nexrad/{catalog,listing,volumes,prefixCache,elevations}` | 1,000 | `decoders/nexrad` |
| `utils/sounding/{geometry,plate,csv,raob,compare,sources}` | 1,500 | `met` |
| `utils/api/{spc,wpc*,wssi,tvs,lsr,metar,cocorahs,tropical-cyclones,discussion}` | 2,000 | `core/net` clients, per-instance pattern from commit `cd1e39a` |
| `utils/s3/listing`, `geo/{stormcast,nominatim}` | 200 | `core/net`, `core/geo` |
| `utils/helpers/{timestamp*,timelineGaps,frameWindow,expiringMap,discussionExpiry}` | 500 | `core/time`, `core/util` |
| `utils/weather/apparent-temperature`, `windUnits`, `Dashboard/utils/wind-arrow` | 100 | `met` |
| `utils/colormaps/bundle`, `public/colormaps.json` | 150 | new `render` entry or data asset |

### C. Tier 2: domain logic, needs untangling first

Some files have `window` or React imports, or are coupled to UI types.

- `components/Dashboard/utils/{hazardInterpretation,hazardPriority,hazardTiming,outlookHits,stormProb,everydayBriefing,dashboardBrief}`. About 2.3k lines; 8 of 20 files impure. Target: `alerts/briefing`.
- `components/Dashboard/extreme-weather/{severe,level,timeline,warningCopy}`, `heat-cold/heatCold.ts`, `Forecast/daily-details/*`, `daily-forecast/dayHazards.ts`. Target: `alerts` or a new `forecast` entry.
- `Map/url/{mapUrlState,layerTokens}`, `Map/ui/timeline/{timelineModel,slots,dayPicker,volumeSlots}`, `Map/ui/split/splitLayers`, `Map/utils/{stormCells,cellMetrics,colormapResolution}`. Pure model logic split from hooks. Worth moving only if a second client (native app, bot) needs it.
- `Dashboard/horizon/{color,sun,theme}`. About 300 lines of pure math. Low value.

### D. Tier 3: do not move

- React components, hooks, CSS.
- `Map/maplibre/*` and shaders (MapLibre and GL dependent).
- `Map/layers/*` GPU tile stores and pipelines.
- `Automation/daily/*` (needs `@napi-rs/canvas`, breaks zero-dependency rule).
- `server/automation`, `proxy.ts`, `app/api/*` (Next specific).
- `utils/analytics`, `nativeApp`, `helpers/audio`, `eas-audio`.
- Worker glue: `*jobRunner`, `protocol`. `utils/models/om/*` needs `@openmeteo/file-reader`; keep in website or expose as an opt-in entry like the JPEG2000 and CCSDS codecs.

## Options Considered

### Option A: Move everything pure plus Tier 2
| Dimension | Assessment |
| --- | --- |
| Complexity | High |
| Cost | Large effort, large surface churn in `api-surface.json` |
| Scalability | One owner for all logic |
| Team familiarity | Medium |

**Pros:** website shrinks most; maximal reuse.
**Cons:** speculative generality for Tier 2; alpha CalVer releases make lockstep website changes painful.

### Option B: Migrate duplicates plus Tier 1 (recommended)
| Dimension | Assessment |
| --- | --- |
| Complexity | Medium |
| Cost | About 20k lines move; tests move with them |
| Scalability | Good; fits existing package boundaries |
| Team familiarity | High |

**Pros:** captures most value; keeps UI-shaped code out of the package.
**Cons:** Tier 2 duplication of domain logic stays in the website.

### Option C: Migrate duplicates only
| Dimension | Assessment |
| --- | --- |
| Complexity | Low |
| Cost | Small |
| Scalability | No new reuse |
| Team familiarity | High |

**Pros:** fixes drift cheaply.
**Cons:** leaves the largest pure modules (models, MRMS, API clients) stranded.

## Trade-off Analysis

Option B gives most of the benefit of A without taking on Tier 2 coupling. Tier 2 should wait for a confirmed second consumer.

## Consequences

- The website test suite is `.mjs`, imports `.ts` by relative path and relies on type stripping. Tests for moved code must move with it, into the package's own test and fixture layout.
- Build `models` first. It is pure and the largest, but Phase 3 ensemble and HAFS work is still changing it. Coordinate to avoid moving a moving target.
- Freeze edits to the duplicated alerts, geo and sounding code in the website before migrating, so drift stops growing.
- Public surface grows. Keep the zero-runtime-dependency rule; anything needing a dependency becomes an opt-in entry or stays in the website.

## Action Items

1. [ ] Reconcile existing drift (`alert-priority`, `polygon`, `thermo`), then replace website copies with package imports.
2. [ ] Move projection, `config/models` and the registry into a new `models` entry with tests and fixtures.
3. [ ] Move the SPC, WPC, METAR, TVS and LSR clients into `core/net`.
4. [ ] Move MRMS and NEXRAD catalog, listing and volume code.
5. [ ] Move sounding geometry, raob and csv into `met`.
6. [ ] Decide on Tier 2 only after a second consumer is confirmed.
7. [ ] Verify purity file by file before each move; the grep above is a heuristic.
