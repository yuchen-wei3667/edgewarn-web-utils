#!/usr/bin/env bash
set -euo pipefail
repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
consumer_dir="$(mktemp -d /tmp/edgewarn-core-consumer.XXXXXX)"
trap 'rm -rf "$consumer_dir"' EXIT
cd "$repo_dir"
npm pack --workspace @edgewarn/core --pack-destination "$consumer_dir" --silent
cd "$consumer_dir"
printf '%s\n' '{"private":true,"type":"module"}' > package.json
npm install --ignore-scripts --no-audit --no-fund ./*.tgz
cat > smoke.mjs <<'JS'
import assert from 'node:assert/strict';
globalThis.fetch = () => { throw Error('import-time request'); };
const geo = await import('@edgewarn/core/geo');
const time = await import('@edgewarn/core/time');
const net = await import('@edgewarn/core/net');
assert.equal(Object.keys(geo).length,14);
assert.equal(Object.keys(time).length,8);
assert.equal(Object.keys(net).length,6);
assert.equal(geo.distanceMiles(0,0,0,0),0);
assert.equal(time.msToTimestamp(0),'19700101-000000');
for (const path of ['@edgewarn/core','@edgewarn/core/cache','@edgewarn/core/net/normalize']) {
  await assert.rejects(import(path), {code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
}
assert.equal(net.normalizeNumber,undefined);
JS
cat > consumer.ts <<'TS'
import type * as GeoJSON from 'geojson';
import { pointInGeometry } from '@edgewarn/core/geo';
import { timestampToMs } from '@edgewarn/core/time';
import { EdgeWARNAPI, NWSAPI, setNwsUserAgent, normalizeStormcellFeatures, toNWSFeature, extractNWSAlertItems } from '@edgewarn/core/net';
import type { EdgeWARNApiConfig, EdgeWARNApiDeps, ExpiryCache, RequestOptions, Cell, StormCellList, NWSForecastPeriod, NWSAlertProperties, NWSAlertFeature, NWSData } from '@edgewarn/core/net';
const geometry: GeoJSON.Polygon = {type:'Polygon',coordinates:[]};
pointInGeometry(0,0,geometry);
timestampToMs('20260102-030405');
const deps: EdgeWARNApiDeps = {cache: <V>(): ExpiryCache<V> => new Map<string,V>()};
declare const config: EdgeWARNApiConfig;
const api = new EdgeWARNAPI(config,deps);
const options: RequestOptions = {signal: new AbortController().signal};
const cells: Promise<Cell[]> = api.downloadCellHistory(1);
const forecast: Promise<{properties:{periods:NWSForecastPeriod[]}}> = NWSAPI.getForecast('https://example.test');
TS
node smoke.mjs
printf '%s\n' '{"compilerOptions":{"noEmit":true,"strict":true,"module":"NodeNext","target":"ES2022","types":[]},"files":["consumer.ts"]}' > tsconfig.json
node "$repo_dir/node_modules/typescript/bin/tsc" -p tsconfig.json
printf '%s\n' 'External tarball runtime and strict declaration checks passed.'
