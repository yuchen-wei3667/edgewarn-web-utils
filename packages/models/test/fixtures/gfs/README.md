# GFS fixtures

Real files from NOAA's public bucket `noaa-gfs-bdp-pds` (0.25 degree `pgrb2`), run 2026-10-25 12Z, object
`gfs.20261025/12/atmos/gfs.t12z.pgrb2.0p25.fNNN`. Measured 2026-10-26.

| File | What it is |
|---|---|
| `gfs.t12z.pgrb2.0p25.f{000,006,012,013,123}.idx` | Full `.idx` inventories. f000 is the analysis (no accumulation windows); f006 and f012 hold `0-6` and `6-12 hour acc` APCP; f013 the 1-hour bucket `12-13` and the run total `0-13`; f123 the 3-hour bucket `120-123` of the 3-hourly tail. Their messages are 743 each (696 at f000). |
| `grid.json` | The grid (`projection: latlon`, 1440 x 721, first point 90 N 0 E, 0.25 degree, scan `0x00`: rows north to south) and the data representation templates (`drt`) seen in every message of f006 (`scripts/models/probe-templates.mjs --all`): 5.0 and 5.3. |

Every model has a `<id>/grid.json` of the same shape (the conformance test requires it). Take one with
`node --import ./tests/setup.mjs scripts/models/read-grid.mjs <object-url> --json` and
`node --import ./tests/setup.mjs scripts/models/probe-templates.mjs <object-url> --all`.
