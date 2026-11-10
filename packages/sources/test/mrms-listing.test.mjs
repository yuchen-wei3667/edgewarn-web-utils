import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    listDay, listNew, listProducts, listTimestamps, mrmsKey, mrmsUrl, parseListing, timestampFromKey, utcDaysBetween,
} from '@edgewarn/web-utils/mrms';
import { keyFor, makeS3, makeTimestamps } from './fixtures/mrms/s3-sim.mjs';

const fixture = (name) => readFileSync(new URL(`./fixtures/mrms/${name}`, import.meta.url), 'utf8');
const P = 'PrecipRate_00.00';

test('parses recorded S3 pages: keys, continuation tokens and truncation', () => {
    const p1 = parseListing(fixture('precip-page1.xml'));
    assert.deepEqual(p1.keys.map((k) => timestampFromKey(k, P)), ['20261011-000000', '20261011-000200', '20261011-000400']);
    assert.match(p1.nextToken, /^1jm76g9Mz\+QyP0k\//); // base64 token with + and / left intact
    const p2 = parseListing(fixture('precip-page2.xml'));
    assert.equal(p2.keys.length, 3);
    assert.notEqual(p2.nextToken, p1.nextToken);
});

test('parses an empty day and the product directory listing', () => {
    assert.deepEqual(parseListing(fixture('empty-day.xml')), { keys: [], prefixes: [], nextToken: null });
    const products = parseListing(fixture('products.xml'));
    assert.equal(products.prefixes.length, 243); // 243 directories, as in the Phase 0 sweep
    assert.ok(products.prefixes.includes('CONUS/PrecipRate_00.00/'));
    assert.equal(products.nextToken, null);
});

test('timestampFromKey is strict and skips malformed keys', () => {
    assert.equal(timestampFromKey(keyFor(P, '20261011-010440'), P), '20261011-010440');
    for (const bad of [
        'CONUS/PrecipRate_00.00/20261011/MRMS_PrecipRate_00.00_20261011-010440.grib2', // not gz
        'CONUS/PrecipRate_00.00/20261011/MRMS_PrecipRate_00.00_20261012-010440.grib2.gz', // day mismatch
        'CONUS/PrecipRate_00.00/20261011/MRMS_PrecipRate_00.00_20261011-250440.grib2.gz', // hour 25
        'CONUS/PrecipRate_00.00/20261011/MRMS_Other_00.00_20261011-010440.grib2.gz', // name mismatch
        'CONUS/PrecipRate_00.00/20261011/', 'garbage',
    ]) assert.equal(timestampFromKey(bad, P), null, bad);
    assert.equal(timestampFromKey(keyFor('VIL_00.50', '20261011-010440'), P), null);
});

test('key and url builders round-trip', () => {
    const ts = '20261011-010440';
    assert.equal(mrmsKey(P, ts), 'CONUS/PrecipRate_00.00/20261011/MRMS_PrecipRate_00.00_20261011-010440.grib2.gz');
    assert.equal(timestampFromKey(mrmsKey(P, ts), P), ts);
    assert.equal(mrmsUrl(P, ts), `https://noaa-mrms-pds.s3.amazonaws.com/${mrmsKey(P, ts)}`);
});

test('pages through continuation tokens and skips malformed keys', async () => {
    const stamps = makeTimestamps(new Date('2026-10-11T00:00:00Z'), new Date('2026-10-11T03:58:00Z'));
    const keys = stamps.map((t) => keyFor(P, t));
    keys.push('CONUS/PrecipRate_00.00/20261011/readme.txt', 'CONUS/PrecipRate_00.00/20261011/MRMS_PrecipRate_00.00_bad.grib2.gz');
    const { fetcher, requests } = makeS3(keys, { pageSize: 50 });
    const got = await listDay(P, '20261011', { fetcher });
    assert.deepEqual(got, stamps);
    assert.equal(requests.length, Math.ceil(keys.length / 50) + (keys.length % 50 === 0 ? 1 : 0));
    assert.ok(requests.slice(1).every((q) => q.includes('continuation-token=')));
});

test('an empty day lists as empty without error', async () => {
    const { fetcher } = makeS3([keyFor(P, '20261011-000000')]);
    assert.deepEqual(await listDay(P, '20200101', { fetcher }), []);
    assert.deepEqual(await listTimestamps(P, new Date('2020-01-01T05:00:00Z'), new Date('2020-01-01T06:00:00Z'), { fetcher }), []);
});

test('a failing listing rejects', async () => {
    const fetcher = async () => new Response('nope', { status: 503 });
    await assert.rejects(listDay(P, '20261011', { fetcher }), /HTTP 503/);
});

test('start-after returns only newer keys with one tiny request', async () => {
    const stamps = makeTimestamps(new Date('2026-10-11T00:00:00Z'), new Date('2026-10-11T01:00:00Z'));
    const { fetcher, requests } = makeS3(stamps.map((t) => keyFor(P, t)));
    const now = new Date('2026-10-11T01:00:30Z');
    const fresh = await listNew(P, stamps[stamps.length - 3], now, { fetcher });
    assert.deepEqual(fresh, stamps.slice(-2));
    assert.equal(requests.length, 1);
    assert.match(requests[0], /start-after=CONUS%2FPrecipRate_00\.00%2F20261011%2FMRMS_/);
    assert.deepEqual(await listNew(P, stamps[stamps.length - 1], now, { fetcher }), []);
});

test('UTC day rollover: the first minutes after 00:00Z are never empty', async () => {
    const stamps = makeTimestamps(new Date('2026-10-10T22:00:00Z'), new Date('2026-10-11T00:04:00Z'));
    const { fetcher } = makeS3(stamps.map((t) => keyFor(P, t)));
    // A 2-hour timeline window ending 00:05Z spans two UTC days and must include yesterday.
    const now = new Date('2026-10-11T00:05:30Z');
    const got = await listTimestamps(P, new Date(now.getTime() - 2 * 3600_000), now, { fetcher });
    assert.equal(got[0], '20261010-220000');
    assert.ok(got.includes('20261010-235800'));
    assert.ok(got.includes('20261011-000400'));
    assert.deepEqual(got, [...got].sort());

    // Incremental refresh crossing midnight picks up the tail of yesterday and the head of today.
    const fresh = await listNew(P, '20261010-235400', now, { fetcher });
    assert.deepEqual(fresh, ['20261010-235600', '20261010-235800', '20261011-000000', '20261011-000200', '20261011-000400']);

    // Before the first file of the new day exists, the refresh still works.
    const early = makeS3(stamps.filter((t) => t < '20261011').map((t) => keyFor(P, t)));
    assert.deepEqual(await listNew(P, '20261010-235600', new Date('2026-10-11T00:00:20Z'), { fetcher: early.fetcher }), ['20261010-235800']);
});

test('utcDaysBetween covers each day once', () => {
    assert.deepEqual(utcDaysBetween(new Date('2026-10-10T23:59:00Z'), new Date('2026-10-11T00:01:00Z')), ['20261010', '20261011']);
    assert.deepEqual(utcDaysBetween(new Date('2026-10-11T01:00:00Z'), new Date('2026-10-11T23:00:00Z')), ['20261011']);
    assert.deepEqual(utcDaysBetween(new Date('2026-12-31T12:00:00Z'), new Date('2027-01-01T12:00:00Z')), ['20261231', '20270101']);
});

test('lists product directories, paging through delimiter results', async () => {
    const keys = ['VIL_00.50', 'PrecipRate_00.00', 'MESH_00.50', 'ANC_FinalForecast_00.00'].flatMap((p) => [keyFor(p, '20261011-000000'), keyFor(p, '20261011-000200')]);
    keys.push('ALASKA/Other/20261011/x.grib2.gz');
    const { fetcher } = makeS3(keys, { pageSize: 2 });
    assert.deepEqual(await listProducts({ fetcher }), ['ANC_FinalForecast_00.00', 'MESH_00.50', 'PrecipRate_00.00', 'VIL_00.50']);
});
