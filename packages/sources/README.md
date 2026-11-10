# Sources (internal)

I/O layer for remote weather data: bucket listings, HTTP range sources and
caches. It exists because `decoders` is decoding-only and cannot call `fetch`.
It is shipped inside `@edgewarn/web-utils` and is not published on its own.

| Subpath | API |
| --- | --- |
| `@edgewarn/web-utils/goes/feed` | GOES bucket listings and timelines, `ReadAheadSource`, `streamAbi`, `GoesBandCache`, tile pyramid and draw planning |
| `@edgewarn/web-utils/nexrad/feed` | NEXRAD Level II archive, chunk and Level III listings, volume timelines and live polling, `receivingState`, `runLevel3Job`, `CacheStoragePrefixStore` |
| `@edgewarn/web-utils/mrms` | MRMS bucket listing, product catalog, lightning sampling, 3D volume geometry and profile sampling, `GzCache` |

Bucket URLs are exported defaults (for example `MRMS_BUCKET_URL`) and every
network function takes `fetcher`, `signal` and `baseUrl` options. Limits are
options with exported defaults (for example `MRMS_VOLUME_LIMITS`, `NEXRAD_LIMITS`). The GOES live
scan mode is a per-call option (`scanMode`); when an empty listing makes the
feed read a different mode from the bucket, it retries with it and reports it
through `onScanModeChange` instead of keeping module state.

Caches are injected, never created here. Persistent byte caches take a
`ResponseStore` (type from `@edgewarn/web-utils/net`); omit it to run uncached.
`GoesBandCache` and `CacheStoragePrefixStore` take the same option; the Level III
header cache of `runLevel3Job` takes an `ExpiryCache`. `GzCache` counts hits, misses and puts; eviction and expiry belong to the store.
This package never touches `localStorage`, `caches` or `window`. Cross-package
imports use `@edgewarn/web-utils/*` and tsconfig `references` set the build
order.

`/mrms` volume geometry builds on `@edgewarn/web-utils/geo`. Distances use
`distanceMeters` (radius 6371008.8 m). Destinations use `calculateDestination`
(radius 6371 km), so a clamped line end differs from the former MRMS-only
formula by about 1.4 ppm (0.2 m over 96 mi).
