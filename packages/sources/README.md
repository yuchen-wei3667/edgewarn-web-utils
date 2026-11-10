# Sources (internal, not yet published)

I/O layer for remote weather data: bucket listings, HTTP range sources and
caches. It exists because `decoders` is decoding-only and cannot call `fetch`.

Planned subpaths (added in website-port plan phases 2 to 4): `/mrms`,
`/goes/feed`, `/nexrad/feed`. None is exported from `package.json` yet.

Caches are injected through the `ExpiryCache` type from
`@edgewarn/web-utils/net`; this package never touches `localStorage` or
`window`. Cross-package imports use `@edgewarn/web-utils/*` and tsconfig
`references` set the build order.
