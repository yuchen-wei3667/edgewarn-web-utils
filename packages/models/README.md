# Models (internal)

Weather-model engine: grid projections, field math, GRIB2 and NetCDF sources, the dataset
registry and its configs, comparison math and HAFS storm tracks. It is shipped inside
`@edgewarn/web-utils` and is not published on its own. Depends on `core`, `decoders`, `met`
and `sources`; imports use `@edgewarn/web-utils/*`.

| Subpath | API |
| --- | --- |
| `@edgewarn/web-utils/models` | Projections (`projectionFor`, `snapToCell`, Lambert, lat/lon, Mercator, polar stereographic, rotated grids and their GLSL), field math (wind rotation, gradients, trajectories, isobars, recipes, tiling), sources (`ModelFetcher`, `RangeSource`, `ModelMessageCache`, GRIB2 index and NetCDF adapters), the registry (run discovery, `MODEL_FIELDS`, `getDataset`, `compileDataset`, `validateConfigs`, `MODEL_CONFIGS`), comparison (`parseExpr`, `evaluate`, `regridLevel`, `runComparison`) and HAFS tracks |

## Contracts

- **Module defaults.** Limits that were website config (`MODEL_TILE_SIZE`, `MODEL_PROBE_ATTEMPTS`,
  `COMPARE_JOB_MAX_BYTES`, ...) are exported constants in `limits.ts`. Where a call needs a
  different value it takes an option: `makeRangeProbe({ attempts, retryMs })`,
  `findNewestRun(..., lookback)`, `runComparison(..., maxBytes)`. Device budgets, level of detail
  and playback timing stay in the website.
- **Caches are injected.** `ModelMessageCache` takes a `ResponseStore` (type from
  `@edgewarn/web-utils/net`) for persistence and keeps a bounded memory LRU in front of it; omit
  the store to run in memory only. `ModelFetcher` takes any `{ get, put }` byte cache. Eviction
  and expiry on disk belong to the store. Nothing here touches `caches`, `localStorage` or `window`.
  In-memory maps expire lazily on use (`TtlMap`, six hours at most); the package starts no timers
  of its own.
- **NetCDF reads use the merged HDF5 reader** `Hdf5File` from `@edgewarn/web-utils/goes`
  through a `RangeSource` backend (cached, merged, retried range reads).
- **The Open-Meteo reader is not here.** `@openmeteo/file-reader` is GPL-2.0. An `om` source needs
  the host to pass `loadSourceAdapter(source, { om })`; without it the call throws. The boundary test
  rejects any `om` or `openmeteo` import.
- **Config is data.** `src/configs/` holds the dataset and field configs that were the website's
  `config/models/**`. A model is one file in `configs/datasets/` plus one line in `configs/index.ts`;
  `ModelId` and the registry follow from `MODEL_CONFIGS`. `hafsStorm.ts` keeps the one module-level
  value of the package, the storm the HAFS URL builders read (`setHafsStorm`).
- **Not ported (website):** the worker job runner and protocol, tile pipeline and GPU code, URL state
  (`compare/serialize.ts`, viewer params), storm popups, export studio, and the OM reader.
