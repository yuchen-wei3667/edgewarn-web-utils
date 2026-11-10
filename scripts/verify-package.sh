#!/usr/bin/env bash
set -euo pipefail
repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
consumer_dir="$(mktemp -d /tmp/edgewarn-web-utils-consumer.XXXXXX)"
trap 'rm -rf "$consumer_dir"' EXIT
cd "$repo_dir"
npm pack --pack-destination "$consumer_dir" --silent
cp packages/decoders/test/fixtures/goes/abi-mini.nc "$consumer_dir/"
cp packages/decoders/test/fixtures/models/jpeg2000/rap-tmp2m-f06.grib2 "$consumer_dir/"
cp packages/decoders/test/fixtures/models/t12z-f00-tmp2m.grib2 "$consumer_dir/"
cp packages/decoders/test/fixtures/nexrad/{synthetic.ar2v,tvs-kemx.bin,level3-products.mjs} "$consumer_dir/"
cp scripts/api-surface.mjs api-surface.json "$consumer_dir/"
cd "$consumer_dir"
printf '%s\n' '{"private":true,"type":"module"}' > package.json
npm install --ignore-scripts --no-audit --no-fund ./*.tgz
API_SURFACE_SNAPSHOT=./api-surface.json node api-surface.mjs
cat > smoke.mjs <<'JS'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
globalThis.fetch = () => { throw Error('import-time request'); };
const { EdgeWARNDecoder, DecodeBudgetExceededError } = await import('@edgewarn/web-utils');
const grib = await import('@edgewarn/web-utils/grib2');
const nexrad = await import('@edgewarn/web-utils/nexrad');
const goes = await import('@edgewarn/web-utils/goes');
const geo = await import('@edgewarn/web-utils/geo');
const time = await import('@edgewarn/web-utils/time');
const net = await import('@edgewarn/web-utils/net');
for (const name of ['createSPCClient','createWPCClient','createReportsClient','createOpenMeteoClient','createNHCClient']) {
  assert.equal(typeof net[name],'function',`${name} is exported from /net`);
  net[name]({ fetch: globalThis.fetch, userAgent: null }); // construction makes no requests
}
assert.equal(net.cycloneCategory(137).step,6);
assert.equal(net.metarHourTimestamps(new Date('2026-11-09T12:45:00Z'),1).length,1);
const colormap = await import('@edgewarn/web-utils/colormap');
const mrms = await import('@edgewarn/web-utils/mrms');
const goesFeed = await import('@edgewarn/web-utils/goes/feed');
const nexradFeed = await import('@edgewarn/web-utils/nexrad/feed');
const metPlot = await import('@edgewarn/web-utils/met/plot');
const met = await import('@edgewarn/web-utils/met');
const column = { validMs: 0, p: Float32Array.of(1000, 900), z: Float32Array.of(0, 1000), t: Float32Array.of(20, 10), td: Float32Array.of(10, 0), u: new Float32Array(2), v: new Float32Array(2), surface: {p:1000,z:0,t:20,td:10,u:0,v:0} };
const cape = met.analyzeSounding(column).parcels.sb.cape;
assert.ok(cape === null || Number.isFinite(cape));
assert.throws(() => met.analyzeSounding({...column, p: Float32Array.of(1000)}), /structurally empty column/);
for (const path of ['met/thermo','met/constants']) await assert.rejects(import('@edgewarn/web-utils/' + path), {code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
const alerts = await import('@edgewarn/web-utils/alerts');
const nwsAlerts = await import('@edgewarn/web-utils/alerts/nws');
assert.deepEqual(Object.keys(nwsAlerts).sort(),['checkNWSRawAlertForEAS','loadLocationAlerts','loadRegionAlerts','createEdgeWARNAlertSource','createNWSAlertSource','createWWAAlertSource'].sort());
assert.equal(alerts.normalizeOfficialAlertId('official:abc'),'abc');
globalThis.fetch = async url => {
  assert.equal(url,'https://api.weather.gov/alerts/active?area=TX');
  return Response.json({features:[]});
};
assert.deepEqual(await nwsAlerts.loadRegionAlerts({area:['TX']},{source:'nws'}),[]);
globalThis.fetch = () => { throw Error('unexpected request'); };
assert.equal(geo.distanceMiles(0,0,0,0),0);
assert.equal(time.msToTimestamp(0),'19700101-000000');
assert.equal(geo.distanceMeters(0,0,0,0),0);
assert.deepEqual(colormap.mapValueToRgba(0,null,[0,1]),[32,32,32,255]);
assert.equal(net.parseS3Listing('').nextToken,null);
assert.equal(typeof alerts.createExpiryWatch,'function');
assert.equal(mrms.timestampFromKey('CONUS/VIL_00.50/20260102/MRMS_VIL_00.50_20260102-030405.grib2.gz'),'20260102-030405');
assert.equal(goesFeed.parseGoesKey('ABI-L2-CMIPC/2026/284/12/OR_ABI-L2-CMIPC-M6C13_G19_s20262841201186_e20262841203559_c20262841204043.nc').channel,'C13');
assert.equal(goes.getGoesBand('GOES_ABI_C13_BrightnessTemp').band,13);
assert.equal(goes.pyramidFromWire({x0:0,y0:0,dx:1e-4,dy:-1e-4,width:2,height:2,perspectivePointHeight:35786023,semiMajorAxis:6378137,semiMinorAxis:6356752.31414,lon0:-75}).width,2);
assert.equal(metPlot.createSkewT().height,1000);
assert.equal(metPlot.barbSymbol(10).knots,20);
assert.equal(met.windFromComponents(0,-10).dirDeg,0);
assert.equal(met.parseRaobColumn({},0),null);
assert.equal(nexradFeed.parseChunkKey('KTLX/186/20261013-001157-003-I').sequence,3);
assert.equal(nexrad.NEXRAD_SITE_BY_ID.get('KTLX').name,'Norman');
assert.equal(nexrad.formatAngle(0.48),'0.5°');
assert.equal(mrms.getMrmsProduct(mrms.DEFAULT_MRMS_PRODUCT).group,'reflectivity');
assert.equal(met.convertKnots(1,'kts'),1);
assert.equal(grib.packedOf(5,{R:0,E:0,D:0}),5);
for (const path of ['@edgewarn/web-utils/cache','@edgewarn/web-utils/net/normalize','@edgewarn/web-utils/alerts/alert-id','@edgewarn/web-utils/alerts/dist/index.js','@edgewarn/web-utils/packages/alerts/dist/index.js']) {
  await assert.rejects(import(path), {code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
}
for (const name of ['fetchWithTimeout','linkedAbortSignal','resolveAllowedFeedUrl','normalizeString','normalizeNullableString','normalizeNumber']) {
  assert.equal(typeof net[name],'function',`${name} is exported from /net`);
}
const decoder = new EdgeWARNDecoder({ memoryLimitBytes:64*1024*1024 });
const bytes = name => new Uint8Array(readFileSync(name));
const options = { format:'grib2', mode:'model', output:'half' };
const field = await decoder.decode(bytes('t12z-f00-tmp2m.grib2'),options);
assert.equal(field.data.length, field.grid.nx * field.grid.ny);
assert.throws(() => grib.decodeGrib2ToHalf(bytes('rap-tmp2m-f06.grib2')),/5.40 not supported/);
grib.registerPacking(grib.JPEG2000_TEMPLATE,grib.decodeJpeg2000Field);
assert.equal((await decoder.decode(bytes('rap-tmp2m-f06.grib2'), options)).grid.nx,451);
const image = await decoder.decode(bytes('abi-mini.nc'),{format:'goes'});
assert.equal(image.width,90);
assert.equal(image.height,60);
let count=0;
await decoder.decode(bytes('synthetic.ar2v'),{format:'nexrad',level:2,onRadial(){count++;}});
assert.ok(count>0);
const { VEL }=await import('./level3-products.mjs');
assert.equal((await decoder.decode(VEL,{format:'nexrad',level:3,product:'radial',moment:'VEL'})).field.rows,4);
assert.equal((await decoder.decode(bytes('tvs-kemx.bin'),{format:'nexrad',level:3,product:'tvs'})).detections.length,1);
assert.deepEqual(grib.BUILT_IN_PACKINGS,[0,2,3]);
for (const name of ['fromHalf','toHalf','HALF_NAN','levelFromValues']) assert.ok(name in grib,`${name} is exported from /grib2`);
assert.equal(typeof goes.inflate,'function');
for(const name of ['@edgewarn/web-utils/packages/core/dist/net/index.js','@edgewarn/web-utils/packages/decoders/dist/index.js','@edgewarn/web-utils/grib2/models/grib2','@edgewarn/web-utils/internal/memory','@edgewarn/web-utils/nexrad/decoder/decoder','@edgewarn/web-utils/met/raob','@edgewarn/web-utils/met/plot/skew-t','@edgewarn/web-utils/nexrad/feed/listing','@edgewarn/web-utils/goes/feed/listing','@edgewarn/web-utils/mrms/listing','@edgewarn/web-utils/mrms/volume/geometry','@edgewarn/web-utils/goes/hdf5']) await assert.rejects(import(name),{code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
JS
cat > consumer.ts <<'TS'
import { analyzeSounding, surfaceParcelDef, liftColumn } from '@edgewarn/web-utils/met';
import type { Column, Vec2, StormMotion, ParcelKey, ParcelResult, AnalysisOptions, LayerBounds, SoundingAnalysis, ParcelDefinition, LiftResult, CapeCheck, BunkersResult, ColumnField, LayerMeanOptions, LiftFn } from '@edgewarn/web-utils/met';
declare const soundingColumn: Column;
const sounding: SoundingAnalysis = analyzeSounding(soundingColumn);
const parcel: ParcelDefinition = surfaceParcelDef(soundingColumn);
const lifted: LiftResult | null = liftColumn(soundingColumn, parcel);
// @ts-expect-error pressure levels must be typed arrays
const invalidColumn: Column = {...soundingColumn, p: [1000, 900]};
import type * as GeoJSON from 'geojson';
import { pointInGeometry } from '@edgewarn/web-utils/geo';
import { timestampToMs, nearestFrameWindow } from '@edgewarn/web-utils/time';
import { mapValueToRgba, extractColormaps } from '@edgewarn/web-utils/colormap';
import type { Colormap } from '@edgewarn/web-utils/colormap';
import { solarPosition, distanceMeters } from '@edgewarn/web-utils/geo';
import { SharedTask, parseS3Listing } from '@edgewarn/web-utils/net';
import { createSPCClient, createWPCClient, createReportsClient, createOpenMeteoClient, createNHCClient } from '@edgewarn/web-utils/net';
import type { SPCClientConfig, WPCClientConfig, ReportsConfig, OpenMeteoConfig, ForecastStorage, NHCClientConfig, CycloneCollection, SPCWatchDetails as NetWatchDetails, MetarEntry, LSRGeoJSON } from '@edgewarn/web-utils/net';
const spcConfig: SPCClientConfig = { baseUrl: 'https://spc.example.test', userAgent: null, fetch };
const watchDetails: Promise<NetWatchDetails | null> = createSPCClient(spcConfig).fetchWatchDetails(42);
const wpcConfig: WPCClientConfig = { hazardsUrl: 'https://wpc.example.test/ero', wssiUrl: 'https://wpc.example.test/wssi', productsUrl: 'https://nws.example.test/products', postProcess: data => data };
const surfaceAnalysis: Promise<GeoJSON.FeatureCollection> = createWPCClient(wpcConfig).fetchSurfaceAnalysis();
const reportsConfig: ReportsConfig = { lsrUrl: 'https://iem.example.test/lsr', now: () => 0 };
const localReports: Promise<LSRGeoJSON> = createReportsClient(reportsConfig).fetchLocalStormReports({});
declare const forecastStorage: ForecastStorage;
const openMeteoConfig: OpenMeteoConfig = { storage: forecastStorage };
const hourlyForecast = createOpenMeteoClient(openMeteoConfig).getHourlyForecast(35, -97);
const nhcConfig: NHCClientConfig = { baseUrl: 'https://nhc.example.test/MapServer' };
const cyclones: Promise<CycloneCollection> = createNHCClient(nhcConfig).fetchForecasts();
// @ts-expect-error the injected storage must implement the full ForecastStorage contract
createOpenMeteoClient({ storage: {} });
// @ts-expect-error outlook days must be in the SPC range
createSPCClient().fetchOutlook(9);
declare const netWatch: NetWatchDetails;
const alertWatch: import('@edgewarn/web-utils/alerts').SPCWatchDetails = netWatch;
import type { S3Object } from '@edgewarn/web-utils/net';
import { createExpiryWatch } from '@edgewarn/web-utils/alerts';
import { GzCache, listDay, getMrmsProduct, clampLine } from '@edgewarn/web-utils/mrms';
import type { MrmsProduct, LatLng } from '@edgewarn/web-utils/mrms';
import type { ResponseStore } from '@edgewarn/web-utils/net';
import { fetchGoesTimeline, GoesBandCache } from '@edgewarn/web-utils/goes/feed';
import type { GoesFrame } from '@edgewarn/web-utils/goes/feed';
import { createSkewT, skewTBackground, windBarbs, buildTimeHeight } from '@edgewarn/web-utils/met/plot';
import type { SkewT, TimeHeightGrid } from '@edgewarn/web-utils/met/plot';
import { buildColumn, fetchRaobColumn, soundingCsv, windFromComponents } from '@edgewarn/web-utils/met';
import type { ColumnSeries, RaobStation } from '@edgewarn/web-utils/met';
import { listArchiveDay, runLevel3Job, receivingState, CacheStoragePrefixStore } from '@edgewarn/web-utils/nexrad/feed';
import type { NexradVolume, Level3Message } from '@edgewarn/web-utils/nexrad/feed';
import { NEXRAD_SITES, buildSweeps, groupTilts } from '@edgewarn/web-utils/nexrad';
import type { Sweep, NexradSite } from '@edgewarn/web-utils/nexrad';
import { GOES_SECTORS, getGoesBand, lonLatToPixel, pyramidFromWire } from '@edgewarn/web-utils/goes';
import type { PyramidGrid, GoesBand } from '@edgewarn/web-utils/goes';
import { convertKnots } from '@edgewarn/web-utils/met';
import type { WindSpeedUnit } from '@edgewarn/web-utils/met';
import { EdgeWARNAPI, NWSAPI, createNWSClient, createWWAClient, normalizeStormcellFeatures, toNWSFeature, extractNWSAlertItems } from '@edgewarn/web-utils/net';
import type { EdgeWARNApiConfig, EdgeWARNApiDeps, ExpiryCache, RequestOptions, Cell, StormCellList, NWSForecastPeriod, NWSAlertProperties, NWSAlertFeature, NWSData } from '@edgewarn/web-utils/net';
import { compareAlertPriority, findAlertsAtPoint } from '@edgewarn/web-utils/alerts';
import type { NWSAlertFeature as AlertFeature, SPCWatchDetails, ParsedSevereHazards, LocationAlert } from '@edgewarn/web-utils/alerts';
import { checkNWSRawAlertForEAS } from '@edgewarn/web-utils/alerts/nws';
import type { EASVerification, AlertRegion, AlertSource, AlertLoaderOptions } from '@edgewarn/web-utils/alerts/nws';
import { loadLocationAlerts, loadRegionAlerts, createWWAAlertSource } from '@edgewarn/web-utils/alerts/nws';
import { WWAAPI } from '@edgewarn/web-utils/net';
import { getDismissedAlerts, selectAlertsToSound, warningCopy, hazardTypeForAlert, getEventColors } from '@edgewarn/web-utils/alerts';
const selected: AlertSource = createWWAAlertSource();
const region: AlertRegion = { wfo: ['KFWD'] };
const regionAlerts: Promise<AlertFeature[]> = loadRegionAlerts(region, { source: 'wwa' });
const pointAlerts: Promise<AlertFeature[]> = loadLocationAlerts({ lat: 35, lon: -97 }, { source: 'nws' });
// @ts-expect-error invalid source ID
loadRegionAlerts(region, { source: 'other' });
// @ts-expect-error exactly four bbox coordinates
loadRegionAlerts({ bbox: [1, 2] }, { source: 'wwa' });
declare const alertFeature: AlertFeature;
const comparison: number = compareAlertPriority(alertFeature,alertFeature);
const matches: LocationAlert[] = findAlertsAtPoint(35,-97,[alertFeature],'Severe');
const verification: Promise<EASVerification> = checkNWSRawAlertForEAS('abc',fetch,{userAgent:'consumer/1.0'});
// @ts-expect-error an alert feature is required
compareAlertPriority('Tornado Warning',alertFeature);
// @ts-expect-error coordinates must be numbers
findAlertsAtPoint('35',-97,[alertFeature]);
const geometry: GeoJSON.Polygon = {type:'Polygon',coordinates:[]};
pointInGeometry(0,0,geometry);
timestampToMs('20260102-030405');
const frames: string[] = nearestFrameWindow(['20260102-030405'],new Date(0),1,s=>s);
const colormaps: Colormap[] = extractColormaps([]);
const rgba: [number,number,number,number] = mapValueToRgba(0,colormaps[0] ?? null,[0,1]);
const meters: number = distanceMeters(0,0,0,0) + solarPosition(0,0,new Date(0)).altitudeDeg;
const task = new SharedTask(async () => 1);
const listed: S3Object[] = parseS3Listing('').objects;
const watch = createExpiryWatch(() => {}, { now: () => 0 });
const skewT: SkewT = createSkewT({ size: 500 });
const background = skewTBackground(skewT, { isobarsHpa: [1000, 500] }).isobars;
const barbs = windBarbs(skewT, soundingColumn);
const timeHeight: TimeHeightGrid = buildTimeHeight([soundingColumn]);
declare const columnSeries: ColumnSeries;
const csv: string = soundingCsv(columnSeries, soundingColumn);
const built = buildColumn(0, [], { t: 20, rh: 50, gu: 0, gv: 0, hsurf: 0 }, 0, false, { lapseKPerM: 0.0065 });
const raob: Promise<Column> = fetchRaobColumn('KOUN', 0);
const wind: { speedMs: number; dirDeg: number } = windFromComponents(1, 1);
declare const station: RaobStation;
void station;
// @ts-expect-error the surface needs t, rh, gu, gv and hsurf
buildColumn(0, [], { t: 20 }, 0);
const goesBand: GoesBand = getGoesBand('GOES_ABI_C13_BrightnessTemp')!;
const goesFrames: Promise<GoesFrame[]> = fetchGoesTimeline(GOES_SECTORS[0], goesBand, new Date(), { fetcher: fetch, scanMode: '6' });
const goesCache = new GoesBandCache({ store, memoryBytes: 1024 });
declare const pyramid: PyramidGrid;
const goesPixel: { col: number; row: number } | null = lonLatToPixel(pyramid, -97, 35);
// @ts-expect-error memoryBytes is required
new GoesBandCache({ store });
const nexradDay: Promise<unknown[]> = listArchiveDay('KTLX', new Date(), { fetcher: fetch });
declare const volumes: NexradVolume[];
const receiving = receivingState({ now: 0, volumes, receiving: null, unreachable: false }).kind;
const prefixes = new CacheStoragePrefixStore({ store, maxBytes: 1024 });
const posted: Level3Message[] = [];
const level3Run: Promise<void> = runLevel3Job({ jobId: 1, site: 'KTLX', volumeId: '20261020-000935', moments: ['VEL'], elevation: { angle: 0.5 } }, { signal: new AbortController().signal, post: (m) => void posted.push(m), headerCache: new Map() }, { bytesRead: 0 });
const site: NexradSite | undefined = NEXRAD_SITES[0];
declare const sweepInput: Sweep[];
const sweeps: Sweep[] = buildSweeps(sweepInput);
// @ts-expect-error maxBytes is required
new CacheStoragePrefixStore({ store });
const mrmsProduct: MrmsProduct | undefined = getMrmsProduct('VIL_00.50');
const mrmsDays: Promise<string[]> = listDay('VIL_00.50', '20260102', { fetcher: fetch });
declare const store: ResponseStore;
const gz = new GzCache({ store });
const mrmsPoint: LatLng = clampLine({ lat: 35, lng: -97 }, { lat: 36, lng: -96 }).b;
// @ts-expect-error store must satisfy ResponseStore
new GzCache({ store: {} });
const unit: WindSpeedUnit = 'kts';
const speed: number = convertKnots(1, unit);
// @ts-expect-error unit must be a known wind speed unit
convertKnots(1, 'ms');
const deps: EdgeWARNApiDeps = {cache: <V>(): ExpiryCache<V> => new Map<string,V>()};
declare const config: EdgeWARNApiConfig;
const api = new EdgeWARNAPI(config,deps);
const requestOptions: RequestOptions = {signal: new AbortController().signal};
const cells: Promise<Cell[]> = api.downloadCellHistory(1);
const nwsClient = createNWSClient({ userAgent: 'consumer/1.0' });
const forecast: Promise<{properties:{periods:NWSForecastPeriod[]}}> = nwsClient.getForecast('https://example.test');
const wwaClient = createWWAClient();
import { EdgeWARNDecoder, DecodeBudgetExceededError } from '@edgewarn/web-utils';
import type * as Root from '@edgewarn/web-utils';
import * as Grib from '@edgewarn/web-utils/grib2';
import * as Nexrad from '@edgewarn/web-utils/nexrad';
import * as Goes from '@edgewarn/web-utils/goes';
const decoder = new EdgeWARNDecoder({memoryLimitBytes:1024});
declare const bytes: Uint8Array;
declare const stream: ReadableStream<Uint8Array>;
declare const sink: Grib.RowSink;
declare const source: Goes.ByteSource;
const half: Promise<Grib.ModelHalfResult> = decoder.decode(bytes,{format:'grib2',mode:'model',output:'half'});
const rows: Promise<Grib.MrmsDecodeResult> = decoder.decode(stream,{format:'grib2',mode:'mrms',sink});
const sync: Grib.ModelLevelsResult = Grib.decodeGrib2(bytes,{mode:'model',output:'levels',levels:[1],factors:[1,2]});
Grib.registerPacking(Grib.CCSDS_TEMPLATE,Grib.decodeCcsdsField);
Grib.registerPacking(Grib.JPEG2000_TEMPLATE,Grib.decodeJpeg2000Field);
const l2: Promise<void> = decoder.decode(stream,{format:'nexrad',level:2,onRadial(radial){Nexrad.materialize(radial.moments[0]);}});
const l3 = decoder.decode(bytes,{format:'nexrad',level:3,product:'radial',moment:'REF'});
const tvs: Promise<Nexrad.TvsProduct|null> = decoder.decode(bytes,{format:'nexrad',level:3,product:'tvs'});
const image: Promise<Goes.AbiGrid> = decoder.decode(source,{format:'goes',dependencies:{createMetadataCache:<V>()=>new Map<string,V>()}});
Goes.AbiFile.open(new Goes.BytesSource(bytes));
// @ts-expect-error model does not accept a stream
Grib.decodeGrib2(stream,{mode:'model',output:'half'});
// @ts-expect-error model output is required
Grib.decodeGrib2(bytes,{mode:'model'});
// @ts-expect-error allocator context is private
Grib.decodeGrib2ToHalf(bytes,{},{});
// @ts-expect-error no unexported paths
import { Memory } from '@edgewarn/web-utils/internal/memory';
TS
node smoke.mjs
printf '%s\n' '{"compilerOptions":{"noEmit":true,"strict":true,"module":"NodeNext","target":"ES2022","types":[],"skipLibCheck":false},"files":["consumer.ts"]}' > tsconfig.json
node "$repo_dir/node_modules/typescript/bin/tsc" -p tsconfig.json
printf '%s\n' 'Unified package: all subpath runtime fixtures and strict declarations passed.'
