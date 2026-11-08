# @edgewarn/web-utils: geometry, time and clients

Portable ESM geometry, time helpers and EdgeWARN/NWS HTTP clients for Node
22.18+, browsers, workers and extension service workers. Select `./geo`, `./time`
or `./net`; the root entry provides decoding. Cache and implementation paths
are private. There are no runtime code dependencies. `@types/geojson` ships for public GeoJSON declarations.

```js
import { distanceMiles, pointInGeometry } from '@edgewarn/web-utils/geo';
const miles = distanceMiles(40, -74, 41, -73);
const inside = pointInGeometry(40, -74, {
  type: 'Polygon', coordinates: [[[-75,39],[-73,39],[-73,41],[-75,41],[-75,39]]]
});
```

Math/polygon tuple functions use `[latitude, longitude]`; GeoJSON uses
`[longitude, latitude]`. `calculateDestination` takes meters and degrees and
returns `[latitude, longitude]`; `distanceMiles` returns statute miles,
`getPolygonApproxRadius` meters, `geometryAreaM2` square meters, and
`formatAlertCoverage` square-mile labels. Polygon projection/hulls use planar
degree offsets. Containment includes outer boundaries and excludes holes and
hole boundaries (epsilon 1e-9). Geographic helpers retain their existing distinct
Earth radii and approximations. They do not repair rings or antimeridian crossings.
Pass only finite numbers to `normalizeLongitude`; infinity does not terminate.

```js
import { timestampToMs, msToTimestamp, roundTimestampToHour } from '@edgewarn/web-utils/time';
const ms = timestampToMs('20260102-030405');
const timestamp = msToTimestamp(ms);
const hour = roundTimestampToHour(timestamp);
```

The eight time exports retain different acceptance rules: `parseTimestampUTC`
trims compact or dotted timestamps, `timestampToMs` accepts only anchored compact
strings, and `formatTimeLabel` extracts either format from surrounding text.
Calendar overflow follows JavaScript Date normalization, including years 00–99.
`findClosestTimestamp` parses in **local time**, truncates seconds, keeps the first
tie and accepts the tolerance boundary (default ten minutes). Its result can vary
across DST/timezones. Rounding uses UTC and rounds half-hours upward. UTC date
labels use en-US. Invalid values retain each helper's original fallback behavior.

```js
import { EdgeWARNAPI, createNWSClient } from '@edgewarn/web-utils/net';
const api = new EdgeWARNAPI({
  baseUrl: 'https://your-server.example',
  routes: {
    stormSnapshots: '/frames', cells: '/cells', alerts: '/alerts',
    alertSnapshots: '/alert-frames', health: '/ready'
  },
  alertQuery: { source: 'official' }, pageSize: 1000
}, { cache: () => new Map() });
const timestamps = await api.fetchTimestamps();
const nws = createNWSClient({ userAgent: 'my-app (contact@example.com)' });
const point = await nws.getPoint(40, -74);
```

Supply a fresh cache per factory call. The caller owns eviction/retention; a plain
Map is suitable for bounded use and tests. Storm snapshot promises are shared and
failed requests evicted. Alert hydration always attempts fresh data, then falls
back to cached features by their returned ID. `downloadNWS` retries failures three
times after its initial attempt; asynchronous callback failures are settled
individually. API routes, page sizes, filters and deployment URLs belong to callers.
Do not mutate a configuration while its client is in use.

NWS rounds coordinates to four decimal places. Each client carries its own
User-Agent (`createNWSClient` / `createWWAClient`, or pass clients via the
alerts loaders' `nws` / `wwa` options) and an optional `baseUrl` override.
The default User-Agent is shared by all upstream clients; no state is shared
between clients in one process, and no environment sniffing is performed.
NWS retains its own nullable response types alongside shared NWS wire types.
`loadLocationAlerts` belongs to the separate alerts package and is outside core.

Invoking clients requires native Fetch, AbortController, URL and DOMException.
Importing the library makes no requests and needs no browser or storage globals.
NWS's private fetch wrapper defaults to a 15-second timeout that ends at response
headers; body consumption is outside that timeout. EdgeWARN request options use
an opt-in timeout (default disabled) covering headers and JSON body consumption.
Abort reasons propagate and request timers/listeners are disposed on completion.

Transport/coercion/feed URL helpers are private. The feed policy accepts absolute
HTTP(S) URLs on noaa.gov/weather.gov and their subdomains, upgrades HTTP, and
retains credentials and ports. It checks neither DNS nor redirects and is not
automatically applied to client URLs. Callers own additional server request policy.
