# Models (internal, not yet published)

Model-data engine: projections, field math, GRIB2 and NetCDF sources and the
dataset registry. Depends on `core`, `decoders` and `sources`.

Planned subpath (website-port plan phase 4): `/models`. It is not exported from
`package.json` yet.

Caches are injected through the `ExpiryCache` type from
`@edgewarn/web-utils/net`. The package never touches `localStorage` or
`window`, and imports no website code.
