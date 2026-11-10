import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { componentAlias, composeTransforms, findIdxEntry, resolveLevel, resolveVariable } from '../dist/catalog.js';
import { getDataset } from '../dist/datasets.js';
import { verticalOf } from '../dist/field.js';
import { ModelMessageCache } from '../dist/messageCache.js';
import {
    countPublishedSteps, findNewestRun, makeRangeProbe, modelFileUrl, ModelHostError,
} from '../dist/listing.js';
import { parseIdx } from '@edgewarn/web-utils/grib2';
import { ModelFetcher } from '../dist/sources/fetcher.js';
import { getModelField, inputsFor } from '../dist/catalog.js';
import { ModelMissing } from '../dist/sources/errors.js';
import { loadSourceAdapter } from '../dist/sources/index.js';
import { probeUrlFor } from '../dist/sources/probe.js';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'decoders', 'test', 'fixtures', 'models');
const fixture = (name) => new Uint8Array(readFileSync(path.join(FIX, name)));
const cache = () => new ModelMessageCache({ memoryBytes: 64e6 });

// ── The grib2-index adapter ──

const INIT = Date.UTC(2026, 9, 12, 12);

/** A bucket serving one HRRR message for every request of the f00 surface object, recording the ranges asked for. */
function bucket(bytes) {
    const url = modelFileUrl(getDataset('hrrr'), INIT, 'sfc', 0);
    const asked = [];
    const fetch = async (u, req = {}) => {
        if (u === `${url}.idx`) return new Response('1:0:d=2026101212:TMP:2 m above ground:anl:\n');
        if (u !== url) return new Response('missing', { status: 404 });
        const m = /bytes=(\d+)-(\d*)/.exec(req.headers.Range);
        asked.push([Number(m[1]), m[2] === '' ? null : Number(m[2])]);
        return new Response(bytes.slice(Number(m[1]), m[2] ? Number(m[2]) + 1 : bytes.length), { status: 206 });
    };
    return { url, fetch, asked };
}

const request = (fieldId, minutes = 0, step = 0) => {
    const dataset = getDataset('hrrr'), def = getModelField(fieldId);
    return { dataset, def, selectors: inputsFor(def, 'hrrr'), model: 'hrrr', product: 'mean', initMs: INIT, minutes, step, level: 2, reducer: 'mean' };
};

test('the wgrib2 adapter reads the one range the inventory names and reports it as a read', async () => {
    const b = bucket(fixture('t12z-f00-tmp2m.grib2'));
    const fetcher = new ModelFetcher({ cache: cache(), fetch: b.fetch });
    const adapter = await loadSourceAdapter(getDataset('hrrr').source);
    const result = await adapter.readInputs(request('HRRR_TMP_2M'), { fetcher, check() {} });
    assert.deepEqual(result.reads, [{ url: b.url, start: 0, end: null }]);
    assert.deepEqual(b.asked, [[0, null]], 'one range request, for exactly that range');
    assert.equal(result.levels.length, 1);
    assert.equal(result.grid.projection, 'lambert');
    assert.equal(result.fetched, fixture('t12z-f00-tmp2m.grib2').length);
});

test('a missing component is reported as missing, naming the inventory', async () => {
    const b = bucket(fixture('t12z-f00-tmp2m.grib2'));
    const fetcher = new ModelFetcher({ cache: cache(), fetch: b.fetch });
    const adapter = await loadSourceAdapter(getDataset('hrrr').source);
    await assert.rejects(adapter.readInputs(request('HRRR_DPT_2M'), { fetcher, check() {} }),
        (e) => e instanceof ModelMissing && /^DPT:2 m above ground is not in .*wrfsfcf00\.grib2\.idx$/.test(e.message));
});

test('an unknown source kind is a clear error, not a request for GRIB', async () => {
    await assert.rejects(() => loadSourceAdapter({ kind: 'shapefile' }), /No source adapter for source kind "shapefile"/);
    await assert.rejects(() => loadSourceAdapter({ kind: 'grib2-index', dialect: 'csv' }), /No inventory dialect "csv"/);
    assert.ok(await loadSourceAdapter({ kind: 'grib2-index', dialect: 'wgrib2' }));
    assert.ok(await loadSourceAdapter({ kind: 'grib2-index', dialect: 'ecmwf' }));
});

// ── The vertical coordinate ──

test('verticalOf reads the level text of a selector', () => {
    assert.deepEqual(verticalOf('surface'), { kind: 'surface' });
    assert.deepEqual(verticalOf('500 mb'), { kind: 'pressure', value: 500, units: 'hPa' });
    assert.deepEqual(verticalOf('2 m above ground'), { kind: 'height-agl', value: 2, units: 'm' });
    assert.deepEqual(verticalOf('0-3000 m above ground'), { kind: 'layer' });
    assert.deepEqual(verticalOf('90-0 mb above ground'), { kind: 'layer' });
    assert.deepEqual(verticalOf('entire atmosphere (considered as a single layer)'), { kind: 'column' });
    assert.deepEqual(verticalOf('0C isotherm'), { kind: 'other' });
});

// ── The probe tells an outage from "not published" ──

const response = (status) => new Response(null, { status });
const fakeFetch = (...answers) => {
    let k = 0;
    const calls = [];
    const fetch = async (url, init) => {
        calls.push([url, init.headers.Range]);
        const next = answers[Math.min(k++, answers.length - 1)];
        if (next instanceof Error) throw next;
        return response(next);
    };
    return { fetch, calls };
};
const quick = { retryMs: 0, sleep: async () => {} };

test('a probe answers yes for a 2xx and no for 404 or 403', async () => {
    assert.equal(await makeRangeProbe({ fetch: fakeFetch(206).fetch, ...quick })('u'), 'yes');
    assert.equal(await makeRangeProbe({ fetch: fakeFetch(404).fetch, ...quick })('u'), 'no');
    assert.equal(await makeRangeProbe({ fetch: fakeFetch(403).fetch, ...quick })('u'), 'no');
});

test('a network or CORS failure is an error, not "not published"', async () => {
    const f = fakeFetch(new TypeError('Failed to fetch'));
    assert.equal(await makeRangeProbe({ fetch: f.fetch, ...quick })('u'), 'error');
    assert.equal(f.calls.length, 1, 'a TypeError is not retried');
});

test('503, 503, 206 is yes; three 5xx or 429 in a row is an error', async () => {
    const recovering = fakeFetch(503, 503, 206);
    assert.equal(await makeRangeProbe({ fetch: recovering.fetch, ...quick })('u'), 'yes');
    assert.equal(recovering.calls.length, 3);
    assert.equal(await makeRangeProbe({ fetch: fakeFetch(503).fetch, ...quick })('u'), 'error');
    assert.equal(await makeRangeProbe({ fetch: fakeFetch(429).fetch, ...quick })('u'), 'error');
    assert.equal(await makeRangeProbe({ fetch: fakeFetch(500, 404).fetch, ...quick })('u'), 'no');
});

test('the probe asks for one byte and waits between tries', async () => {
    const f = fakeFetch(503, 206);
    const waits = [];
    await makeRangeProbe({ fetch: f.fetch, retryMs: 100, sleep: async (ms) => { waits.push(ms); } })('u');
    assert.deepEqual(f.calls.map((c) => c[1]), ['bytes=0-0', 'bytes=0-0']);
    assert.deepEqual(waits, [100]);
});

test('an abort is passed on, never swallowed as an error', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    await assert.rejects(() => makeRangeProbe({ fetch: fakeFetch(abort).fetch, ...quick })('u'), /aborted/);
});

test('listing: an unreachable host throws ModelHostError; a plain "no" is a run not out yet', async () => {
    const hrrr = getDataset('hrrr');
    await assert.rejects(() => countPublishedSteps(hrrr, INIT, async () => 'error'), (e) => e instanceof ModelHostError && e.message === 'Data host unreachable');
    assert.equal(await countPublishedSteps(hrrr, INIT, async () => 'no'), 0);
    assert.equal(await countPublishedSteps(hrrr, INIT, async () => false), 0, 'a plain boolean still stands for yes and no');
    assert.equal(await findNewestRun(INIT + 60_000, async () => 'no', undefined, hrrr), null);
    await assert.rejects(() => findNewestRun(INIT + 60_000, async () => 'error', undefined, hrrr), ModelHostError);
});

test('a listable bucket counts a run in one listing per file, and a refused listing falls back to probes', async () => {
    const hrrr = getDataset('hrrr');
    const keyOf = (file, step) => new URL(probeUrlFor(hrrr, modelFileUrl(hrrr, INIT, file, step))).pathname.slice(1);
    const out = new Set(hrrr.files.flatMap((file) => [0, 1, 2, 3, 4, 5].map((step) => keyOf(file, step))));
    out.add(keyOf(hrrr.files[0], 6)); // step 6 is out in one file only
    for (const file of hrrr.files) out.add(keyOf(file, 7)); // step 7 finished before 6: the gap still ends the run
    const listed = [];
    let probes = 0;
    const probe = Object.assign(async () => { probes++; return 'no'; }, {
        listKeys: async (baseUrl, prefix) => { listed.push(prefix); return new Set([...out].filter((k) => k.startsWith(prefix))); },
    });
    assert.equal(await countPublishedSteps(hrrr, INIT, probe), 6);
    assert.equal(listed.length, hrrr.files.length);
    assert.equal(probes, 0);

    const refused = Object.assign(async (url) => (url.includes('f00') ? 'yes' : 'no'), {
        listKeys: async () => { throw new Error('Model run listing failed: HTTP 403'); },
    });
    assert.equal(await countPublishedSteps(hrrr, INIT, refused), 1);
});

test('the probe URL is the .idx for GRIB sources and the object for OM', () => {
    assert.equal(probeUrlFor(getDataset('hrrr'), 'https://x/a.grib2'), 'https://x/a.grib2.idx');
    assert.equal(probeUrlFor({ source: { kind: 'om', manifest: 'm' } }, 'https://x/a.om'), 'https://x/a.om');
});

// ── The shared fetcher ──

test('adjacent ranges of one object are one request, and a repeat is served from the cache', async () => {
    const body = new Uint8Array(100).map((_, k) => k);
    const asked = [];
    const fetch = async (u, init) => {
        const m = /bytes=(\d+)-(\d*)/.exec(init.headers.Range);
        asked.push(init.headers.Range);
        return new Response(body.slice(Number(m[1]), Number(m[2]) + 1), { status: 206 });
    };
    const fetcher = new ModelFetcher({ cache: cache(), fetch });
    const ranges = [{ url: 'u', start: 10, end: 19 }, { url: 'u', start: 20, end: 29 }, { url: 'u', start: 50, end: 59 }];
    const first = await fetcher.readRanges(ranges);
    assert.deepEqual(asked, ['bytes=10-29', 'bytes=50-59']);
    assert.deepEqual(Array.from(first.bytes[1]), Array.from(body.slice(20, 30)));
    assert.equal(first.fetched, 30);
    const second = await fetcher.readRanges(ranges);
    assert.equal(second.fetched, 0);
    assert.equal(asked.length, 2, 'nothing was fetched twice');
});

test('a text object is fetched once; a failure is forgotten so the next call tries again', async () => {
    let calls = 0;
    let fail = true;
    const fetcher = new ModelFetcher({ cache: cache(), fetch: async () => { calls++; return fail ? new Response('', { status: 503 }) : new Response('hello'); } });
    await assert.rejects(() => fetcher.text('u'), /HTTP 503 for u/);
    fail = false;
    assert.equal(await fetcher.text('u'), 'hello');
    assert.equal(await fetcher.text('u'), 'hello');
    assert.equal(calls, 2);
});

test('the fetcher stops at the next request once the job is cancelled', async () => {
    const fetcher = new ModelFetcher({ cache: cache(), fetch: async () => new Response(new Uint8Array(4), { status: 206 }) });
    await assert.rejects(() => fetcher.readRanges([{ url: 'u', start: 0, end: 3 }], () => { throw new Error('cancelled'); }), /cancelled/);
});

// ── Component aliases ──

test('an alias beats a variable rename, which beats the selector as written; exact skips both', () => {
    const base = getDataset('hrrr');
    const dataset = {
        ...base,
        variables: { TMP: 'TMP_RENAMED' },
        components: { 'TMP|2 m above ground': { variable: 'temperature_2m', level: '', transform: { offset: -273.15 } } },
    };
    assert.equal(resolveVariable(dataset, 'TMP', false, '2 m above ground'), 'temperature_2m');
    assert.equal(resolveLevel(dataset, '2 m above ground', false, 'TMP'), '');
    assert.equal(resolveVariable(dataset, 'TMP', false, '500 mb'), 'TMP_RENAMED', 'no alias for that level: the rename applies');
    assert.equal(resolveVariable(dataset, 'TMP', true, '2 m above ground'), 'TMP');
    assert.equal(resolveLevel(dataset, '2 m above ground', true, 'TMP'), '2 m above ground');
    assert.deepEqual(componentAlias(dataset, { variable: 'TMP', level: '2 m above ground' }).transform, { offset: -273.15 });
    assert.equal(componentAlias(dataset, { variable: 'TMP', level: '2 m above ground', exact: true }), undefined);
});

test('an aliased component is found in an inventory under its own spelling', () => {
    const base = getDataset('hrrr');
    const dataset = { ...base, components: { 'TMP|2 m above ground': { variable: 'T2M', level: 'sfc' } } };
    const entries = parseIdx('1:0:d=2026101212:T2M:sfc:6 hour fcst:\n2:9:d=2026101212:TMP:2 m above ground:6 hour fcst:\n');
    const sel = { file: 'sfc', variable: 'TMP', level: '2 m above ground', timing: 'instant' };
    assert.equal(findIdxEntry(entries, sel, 360, dataset).variable, 'T2M');
    assert.equal(findIdxEntry(entries, { ...sel, exact: true }, 360, dataset).variable, 'TMP');
});

test('transforms compose: the alias converts the source unit first, then the selector applies its own', () => {
    // Pa to hPa, then hPa - 1000.
    assert.deepEqual(composeTransforms({ scale: 0.01 }, { offset: -1000 }), { scale: 0.01, offset: -1000 });
    // K to degrees C, then degrees C to F-ish scale 2: ((v - 273.15) * 2).
    const t = composeTransforms({ offset: -273.15 }, { scale: 2 });
    assert.ok(Math.abs(300 * t.scale + t.offset - 2 * (300 - 273.15)) < 1e-9);
    assert.equal(composeTransforms(undefined, { scale: 3 }).scale, 3);
    assert.deepEqual(composeTransforms({ scale: 3 }, undefined), { scale: 3 });
    assert.equal(composeTransforms(undefined, undefined), undefined);
});

test('range progress counts fetched inputs and cached inputs', async () => {
    const fetcher = new ModelFetcher({ cache: cache(), fetch: async () => new Response(new Uint8Array(8), { status: 206 }) });
    const ranges = [{ url: 'u', start: 0, end: 3 }, { url: 'u', start: 4, end: 7 }];
    const progress = [];
    await fetcher.readRanges(ranges, undefined, (done, total) => progress.push([done, total]));
    assert.deepEqual(progress, [[0, 2], [1, 2], [2, 2]]);
    progress.length = 0;
    await fetcher.readRanges(ranges, undefined, (done, total) => progress.push([done, total]));
    assert.deepEqual(progress, [[2, 2]]);
});
