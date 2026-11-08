# Alert evaluation

`@edgewarn/web-utils/alerts` provides the Website's portable alert classification,
priority, location matching, geometry normalization and formatting functions.
`@edgewarn/web-utils/alerts/nws` verifies an alert against NWS text products.
Both entry points are safe to import without a browser or an HTTP request.

```ts
import { compareAlertPriority, findAlertsAtPoint } from '@edgewarn/web-utils/alerts';
import type { NWSAlertFeature } from '@edgewarn/web-utils/alerts';
import { checkNWSRawAlertForEAS } from '@edgewarn/web-utils/alerts/nws';

declare const features: NWSAlertFeature[];
const ordered = [...features].sort(compareAlertPriority);
const atLocation = findAlertsAtPoint(35, -97, features, 'Severe');
const verification = await checkNWSRawAlertForEAS('alert-id', fetch, {
  userAgent: 'my-service/1.0 (https://example.org/contact)',
});
```

The P0 API comprises these 32 runtime names:

| Area | Exports |
| --- | --- |
| Identity | `normalizeAlertId`, `normalizeOfficialAlertId`, `getFeatureAlertCacheKey` |
| Geometry | `normalizeAlertGeometry` |
| Filtering and evaluation | `filterNwsAlerts`, `alertsForPeriod`, `mostUrgentAlertForHour`, `findAlertsAtPoint`, `mergeLocationAlerts` |
| Priority | `alertPriorityRank`, `compareAlertPriority`, `sortDashboardAlerts` |
| Tornado | `tornadoAlertText`, `isTornadoWarning`, `isTornadoEmergency`, `isPdsTornado`, `isConfirmedTornado` |
| Other classification | `isSevereThunderstormWarning`, `isFlashFloodWarning`, `CRITICAL_EVENTS`, `isCriticalAlertEvent`, `isDashboardSignificantAlert`, `isDashboardTopBannerAlert`, `isSevereTabAlert`, `extractSevereHazards` |
| EAS phrase | `hasEASActivation`, `hasEASActivationRequest` |
| SPC | `getSPCWatchTypeFromEvent`, `extractSpcWatchNumber` |
| Formatting | `formatAlertTime`, `formatAlertTimeUntil`, `formatNwsAlertText` |

Public types are `NWSAlertProperties`, `NWSAlertFeature`, `NWSData` (owned by
`/net`), `SPCWatchType`, `SPCWatchProbabilities`, `SPCWatchAttributes`,
`SPCWatchSourceUrls`, `SPCWatchDetails`, `LocationAlert`,
`LocationAlertFeatureInput`, `LocationAlertMinimumSeverity`, and `ParsedSevereHazards`.

The P0 NWS API exports one runtime function, `checkNWSRawAlertForEAS`, and the
`EASVerification` type. It accepts an injected `fetch` and optional User-Agent.
Requests have an 8-second timeout; upstream errors reject the promise. Its result
separates historical EAS eligibility (`easRequested`) from eligibility for a new
tone (`currentIssuanceRequestsEAS`). Follow-up issuances do not replay the original
tone, and cancellations never request playback. Product detail URLs must belong
to `https://api.weather.gov`. Framework caching belongs in the caller's fetcher.

Compatibility rules retained from the Website:

- The three ID functions deliberately normalize prefixes differently.
- Point matching uses geometry and severity, ignoring expiry, status and message
  type. Null geometry does not match. Supply a separate validity filter when needed.
- Outer polygon boundaries match; hole boundaries and interiors do not.
- The legacy `Polygon` field swaps a positive first coordinate and negative second
  coordinate. This historical Western Hemisphere assumption remains unchanged.
- Priority, dashboard sorting and location sorting use distinct orderings.
- The synchronous EAS priority boost reads only the description.
- `alertsForPeriod` rejects future sent times, test messages and cancellations,
  prefers onset to effective, and caps ends at expires.
- `formatAlertTime` uses the host's local time zone; `formatAlertTimeUntil` takes
  the current clock explicitly.

Cache state, UI, audio, browser storage access, polling and zone matching remain
in the Website. No implementation deep paths are exported. Copy provenance is recorded in
[validation metadata](validation metadata); tests retain the frozen Website
behavior fixtures.

P1 also exports `alertMatchesFilter`, `alertEASKey`,
`isEASVerificationCandidate`, `getDismissedAlerts`, `saveDismissedAlert`,
`selectAlertsToSound`, `isFlashFloodEmergency`, `hazardParts`, `hazardLine`,
`warningCopy`, `heroTitleForAlert`, `hazardTypeForAlert` and `getEventColors`.
There are 45 root runtime exports in total. Additional types are `DismissalStorage`,
`DismissedAlert`, `WarningCopy` and `HazardType`.

Dismissal functions receive storage and retention explicitly, with an optional
`now` in milliseconds. They keep `edgewarn_dismissed_alerts` and expire records
by `dismissedAt`, independently of the alert's expiry. The caller schedules any
cleanup and owns browser access. `selectAlertsToSound(alerts, played)` returns
unplayed items in their existing order through the first critical item. The
caller records playback; selection does not mutate its set or play audio.

The NWS entry also exports `loadLocationAlerts`, `loadRegionAlerts`,
`createEdgeWARNAlertSource`, `createNWSAlertSource`, `createWWAAlertSource`, and
the types `AlertLoaderOptions`, `AlertSource`, `AlertSourceId`, `AlertRegion`,
`AlertRegionKind`.

```ts
import { loadLocationAlerts, loadRegionAlerts } from '@edgewarn/web-utils/alerts/nws';

const local = await loadLocationAlerts({ lat: 35, lon: -97 }, {
  source: 'nws', signal: new AbortController().signal,
});
const state = await loadRegionAlerts({ area: ['TX', 'OK'] }, { source: 'nws' });
const office = await loadRegionAlerts({ wfo: ['KFWD'] }, { source: 'wwa' });
```

Both loaders accept `{ edgewarn?, source?, signal? }`. The default selection is
`['edgewarn', 'nws']` and requires a configured core `EdgeWARNAPI` instance.
WWA is opt-in. An invalid or empty selection, or selecting EdgeWARN without an
instance, rejects before a request. Regions have exactly one selector:

| Selector | Supporting sources |
| --- | --- |
| `{ area: string[] }`, `{ region: string[] }`, `{ zone: string[] }` | NWS |
| `{ wfo: string[] }` (four uppercase letters) | WWA |
| `{ bbox: [west, south, east, north] }` | EdgeWARN, WWA |

Codes must be nonempty. Coordinates must be finite and within longitude/latitude
bounds; boxes must have west ≤ east and south ≤ north (no antimeridian wrapping).
Unsupported sources are skipped for region loads; none supporting the selector
rejects. Results merge by normalized ID in fixed EdgeWARN → NWS → WWA precedence,
with the **first copy winning**, then sort in dashboard order. This precedence is
the new source-selection contract: the historical `mergeLocationAlerts` helper
continues to keep the last duplicate when called directly.

A successful empty source counts as success. If every participating source fails,
loaders reject with `AggregateError`; individual reasons are available in `errors`.
Caller cancellation always rejects, even if another source succeeded. Hydration
runs in batches of eight. EdgeWARN point hydration retains the snapshot when a
download returns null; bbox loads intersect snapshot geometry without hydration
and omit alerts without polygon geometry. UGC/zone matching is not provided.

WWA queries NOAA's fixed layer 1 endpoint, then hydrates CAP IDs through NWS.
Failed or invalid hydration is dropped; if every candidate fails, the source
rejects. A missing hydrated geometry receives the WWA polygon. Truncated WWA
responses reject. NWS and WWA share core's configured User-Agent; server callers
can set it with `setNwsUserAgent` from `/net`. Source constructors use core's
HTTP clients; they introduce no cache or polling state.
