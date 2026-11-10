import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getDataset, VIEWER_MODEL_IDS } from '../dist/datasets.js';
import { getModelField, inputsFor } from '../dist/catalog.js';
import { loadSourceAdapter } from '../dist/sources/index.js';
import { ModelFetcher } from '../dist/sources/fetcher.js';
import { ModelMessageCache } from '../dist/messageCache.js';
import { ModelCancelled, ModelHttpError, ModelMissing } from '../dist/sources/errors.js';
import { countPublishedSteps, makeRangeProbe, modelFileUrl } from '../dist/listing.js';
import { fromHalf } from '@edgewarn/web-utils/grib2';
import { netcdfVariableUrl } from '../dist/netcdf/gridReader.js';

const BUCKET = 'https://met-office-atmospheric-model-data.s3.eu-west-2.amazonaws.com';
const FILE = new URL('./fixtures/ukmo-global/fog-fraction.nc', import.meta.url);
const real = readFileSync(FILE);
const initMs = Date.UTC(2026, 10, 2, 0);
const cache = () => new ModelMessageCache({ memoryBytes: 8e6 });

/**
 * A browser's view of the Met Office bucket: HEAD gives Content-Length, a range answers 206, and Content-Range is not
 * exposed to the page (CORS exposes only ETag), so the response carries none. `files` maps a URL to its bytes.
 */
const bucket = (files, log = []) => async (url, init = {}) => {
    const bytes = files[url];
    log.push([init.method ?? 'GET', url, init.headers?.Range]);
    if (!bytes) return new Response(null, { status: 404 });
    if (init.method === 'HEAD') return new Response(null, { status: 200, headers: { 'content-length': String(bytes.length) } });
    const range = /^bytes=(\d+)-(\d+)$/.exec(init.headers?.Range ?? '');
    assert.ok(range, `an absolute range, not ${init.headers?.Range}`);
    return new Response(bytes.subarray(Number(range[1]), Math.min(Number(range[2]) + 1, bytes.length)), { status: 206 });
};

const stepUrl = (step, name = 'fog_fraction_at_screen_level') =>
    `${BUCKET}/global-deterministic-10km/20261102T0000Z/20261102T${String(step).padStart(2, '0')}00Z-PT${String(step).padStart(4, '0')}H00M-${name}.nc`;

test('ukmo-global: reads the Met Office bucket directly as NetCDF, with no Open-Meteo in the path', () => {
    const d = getDataset('ukmo-global');
    assert.ok(VIEWER_MODEL_IDS.includes('ukmo-global'));
    assert.equal(d.source.kind, 'netcdf');
    assert.equal(d.pointSeries, null);
    assert.equal(d.capabilities.discovery, 'probe');
    assert.equal(d.about.derivedFrom, undefined);
    assert.doesNotMatch(d.about.attribution, /Open-Meteo/);
    assert.equal(modelFileUrl(d, initMs, d.fileOf('sfc', 'mean'), 3), stepUrl(3, 'temperature_at_screen_level'));
    assert.equal(modelFileUrl(d, initMs, d.fileOf('prs', 'mean'), 150),
        `${BUCKET}/global-deterministic-10km/20261102T0000Z/20261108T0600Z-PT0150H00M-temperature_on_pressure_levels.nc`);
    assert.equal(netcdfVariableUrl(modelFileUrl(d, initMs, d.fileOf('sfc', 'mean'), 3), 'wind_gust_at_10m'), stepUrl(3, 'wind_gust_at_10m'));
});

test('ukmo-global: hourly to 54 h, then 3-hourly and 6-hourly; the 06 and 18 UTC runs stop at 69 h', () => {
    const d = getDataset('ukmo-global');
    assert.equal(d.runSteps(0), 168);
    assert.equal(d.runSteps(18), 69);
    assert.deepEqual(d.stepsFor(0).filter((m) => m >= 54 * 60).map((m) => m / 60).slice(0, 4), [54, 57, 60, 63]);
    assert.ok(d.stepsFor(12).includes(150 * 60) && !d.stepsFor(12).includes(147 * 60));
    assert.deepEqual(d.stepsFor(6).slice(-3).map((m) => m / 60), [63, 66, 69]);
    assert.equal(d.fieldSteps('HRRR_TMP_2M', 0), null);
});

test('ukmo-global: a step is published once both its files are, probing by range and never listing the run', async () => {
    const d = getDataset('ukmo-global'), log = [];
    const out = new Set();
    // Hours 0 to 5 are out in both files; hour 6 only in the surface file.
    for (let h = 0; h <= 6; h++) out.add(modelFileUrl(d, initMs, d.fileOf('sfc', 'mean'), h));
    for (let h = 0; h <= 5; h++) out.add(modelFileUrl(d, initMs, d.fileOf('prs', 'mean'), h));
    const probe = makeRangeProbe({ fetch: async (url, init) => {
        log.push(url);
        assert.equal(init.headers.Range, 'bytes=0-0');
        return new Response(null, { status: out.has(url) ? 206 : 404 });
    } });
    assert.equal(await countPublishedSteps(d, initMs, probe), 6);
    assert.ok(log.every((url) => url.endsWith('.nc')), 'no ListObjectsV2 call');
    assert.ok(log.length < 24, `${log.length} probes`);
    assert.equal(await countPublishedSteps(d, initMs, makeRangeProbe({ fetch: async () => new Response(null, { status: 404 }) })), 0);
});

test('a real Met Office file decodes offline from absolute ranges, checks against h5py, and is cached', async () => {
    const d = getDataset('ukmo-global'), def = getModelField('OM_CLOUD_2M');
    const log = [], fetcher = new ModelFetcher({ cache: cache(), fetch: bucket({ [stepUrl(3)]: real }, log) });
    const adapter = await loadSourceAdapter(d.source);
    const request = (extra = {}) => ({ dataset: d, def, selectors: inputsFor(def, d.id), model: d.id, initMs, product: 'mean', minutes: 180, step: 3, level: 0, reducer: 'mean', ...extra });
    const result = await adapter.readInputs(request(), { fetcher, check() {} });
    const { nx, ny, data } = result.levels[0];
    assert.deepEqual([nx, ny], [2560, 1920]);
    // The file stores a fraction; the alias turns it to percent. Values are from h5py on the same file.
    for (const [j, i, fraction] of [[0, 0, 0], [40, 38, 0.5], [40, 40, 0.75], [1919, 2559, 0.25]]) {
        assert.equal(fromHalf(data[j * nx + i]), fraction * 100);
    }
    // The whole field is the whole file; the 64 KB tail read first overlaps its last chunks.
    assert.ok(result.fetched <= real.length + 64 * 1024, `${result.fetched} bytes of a ${real.length} byte file`);
    assert.equal(log.filter(([method]) => method === 'HEAD').length, 1);
    assert.ok(log.every(([, url]) => url === stepUrl(3)));
    const requests = log.length;
    assert.equal((await adapter.readInputs(request(), { fetcher, check() {} })).fetched, 0);
    assert.equal(log.length, requests);
    await assert.rejects(adapter.readInputs(request({ step: 4 }), { fetcher, check() {} }), (error) => error instanceof ModelHttpError && error.status === 404);
    await assert.rejects(adapter.readInputs(request({ selectors: [{ file: 'sfc', variable: 'NOT_PUBLISHED', level: 'surface', timing: 'instant' }] }), { fetcher, check() {} }), ModelMissing);
    await assert.rejects(adapter.readInputs(request({ dataset: { ...d, grid: { ...d.grid, nx: 2 } } }), { fetcher, check() {} }), /grid variables/);
    await assert.rejects(adapter.readInputs(request(), { fetcher: new ModelFetcher({ cache: cache(), fetch: bucket({ [stepUrl(3)]: real }) }), check() { throw new ModelCancelled(); } }), ModelCancelled);
});
