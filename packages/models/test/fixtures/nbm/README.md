# NBM fixtures

Real files from NOAA's public bucket `noaa-nbm-grib2-pds` (CONUS `co` grid, `core` product), run
2026-10-22 12Z, object `blend.20261022/12/core/blend.t12z.core.fNNN.co.grib2`.

| File | What it is |
|---|---|
| `blend.t12z.core.f{001,012,048,051,060,198}.co.grib2.idx` | Full `.idx` inventories, one per schedule segment. The message count falls from 213 (f012) to 74 (f051) and 70 (f198), so which fields exist depends on the step. |
| `t12z-f012-vis.grib2` | One GRIB2 message, `VIS:surface:12 hour fcst`, byte range 172020182-172674837 of the f012 object (grid 3.30, scan mode `0x50`: adjacent rows scan in opposite directions). |
| `step-availability.json` | Written by `scripts/models/measure-step-availability.mjs`: every step that exists (1-48 hourly, 51-192 every 3 h, 198-264 every 6 h, identical for 00/06/12/18Z) and, per component (`VAR\|level\|timing\|extra`), the steps whose `.idx` carries it. A dataset's `runs` and `fieldSteps` must equal this. |

Measure again with
`node --import ./tests/setup.mjs scripts/models/measure-step-availability.mjs 'https://noaa-nbm-grib2-pds.s3.amazonaws.com/blend.YYYYMMDD/12/core/blend.t12z.core.f{step3}.co.grib2' 1 264 out.json`.
