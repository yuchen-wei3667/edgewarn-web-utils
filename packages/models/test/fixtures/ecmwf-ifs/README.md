# ECMWF IFS fixtures

Real files from ECMWF's open-data mirror `ecmwf-forecasts` (0.25 degree IFS HRES, stream `oper`), run 2026-10-25 00Z,
object `20261025/00z/ifs/0p25/oper/20261025000000-<N>h-oper-fc`. Measured 2026-10-26.

| File | What it is |
|---|---|
| `ifs.t00z.oper.f{000,012,150}.index` | Whole `.index` inventories (one JSON object per message, with `_offset` and `_length`). f000 is the analysis, f012 an ordinary 3-hourly step, f150 the first 6-hourly one (its maxima and minima are `mx2t6`/`mn2t6`, not `mx2t3`/`mn2t3`). |
| `t00z-f012-{sd,tprate,2t,mucape}.grib2` | Single messages cut out of the f012 object by their `_offset`/`_length`: `sd` and `tprate` are zero over most of the globe (75% and 65%), the others a smooth field (`2t`) and a heavy-tailed one (`mucape`). All are CCSDS-packed (template 5.42, block size 32, reference interval 128, flags 14). |
| `reference.json` | 40 values per message spread over the grid, read with ecCodes 2.50 (`codes_get_values`), plus the packing options ecCodes reports. The decoder was also compared with ecCodes at every one of the 1 038 240 points of these four messages and of `tp`, `tcc`, `10fg`, `gh` 500 and `u` 250, with no difference beyond float16 rounding. |
| `grid.json` | The grid (`projection: latlon`, 1440 x 721, first point 90 N **180 E**, 0.25 degree, scan `0x00`) and the data representation template seen in every message (`drt`: 42, CCSDS). |

The grid starts on the date line, not at 0 E as GFS does; the projection handles any first longitude.
