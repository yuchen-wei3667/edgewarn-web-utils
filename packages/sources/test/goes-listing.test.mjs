import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getGoesBand, getGoesSector } from '@edgewarn/web-utils/goes';
import {
    fetchGoesTimeline, fetchGoesTimelineNear, fileStem, hourPrefix, hoursBetween, listNewFrames, listScans, mergeFrames, parseGoesKey,
    parseGoesListing, scanTimestamp,
} from '@edgewarn/web-utils/goes/feed';

const fixture = (name) => readFileSync(new URL(`./fixtures/goes/${name}`, import.meta.url), 'utf8');
const C13 = getGoesBand('GOES_ABI_C13_BrightnessTemp');
const C02 = getGoesBand('GOES_ABI_C02_Reflectance');
const CONUS = getGoesSector('C'), M1 = getGoesSector('M1'), M2 = getGoesSector('M2');

/** S3 ListObjectsV2 over an in-memory key set: prefix, start-after, max-keys; records every query. */
function fakeBucket(objects) {
    const sorted = [...objects].sort((a, b) => (a.key < b.key ? -1 : 1));
    const calls = [];
    const fetcher = async (url) => {
        const q = new URL(url).searchParams;
        calls.push(Object.fromEntries(q));
        const prefix = q.get('prefix') ?? '', after = q.get('start-after') ?? '', max = Number(q.get('max-keys') ?? 1000);
        const hits = sorted.filter((o) => o.key.startsWith(prefix) && o.key > after).slice(0, max);
        const body = `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><IsTruncated>false</IsTruncated>${hits.map((o) => `<Contents><Key>${o.key}</Key><Size>${o.size ?? 1000}</Size></Contents>`).join('')}</ListBucketResult>`;
        return new Response(body, { status: 200 });
    };
    return { fetcher, calls };
}

/** Recorded pages answer exactly the prefix they were recorded for; anything else is an empty listing. */
function recordedBucket() {
    const pages = new Map([
        ['ABI-L2-CMIPC/2026/284/12/OR_ABI-L2-CMIPC-M6C13_G19_', 'list-cmipc-c13-284-12.xml'],
        ['ABI-L2-CMIPC/2026/284/12/OR_ABI-L2-CMIPC-M6C02_G19_', 'list-cmipc-c02-284-12.xml'],
        ['ABI-L2-MCMIPC/2026/284/12/OR_ABI-L2-MCMIPC-M6_G19_', 'list-mcmipc-284-12.xml'],
        ['ABI-L2-CMIPM/2026/284/12/OR_ABI-L2-CMIPM1-M6C13_G19_', 'list-cmipm1-c13-284-12.xml'],
        ['ABI-L2-CMIPM/2026/284/12/OR_ABI-L2-CMIPM2-M6C13_G19_', 'list-cmipm2-c13-284-12.xml'],
    ]);
    const calls = [];
    const fetcher = async (url) => {
        const prefix = new URL(url).searchParams.get('prefix');
        calls.push(prefix);
        const name = pages.get(prefix);
        return new Response(name ? fixture(name) : '<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>', { status: 200 });
    };
    return { fetcher, calls };
}

const key = (product, stem, ch, start) => {
    const [y, doy, hh] = [start.slice(0, 4), start.slice(4, 7), start.slice(7, 9)];
    return `${product}/${y}/${doy}/${hh}/OR_ABI-L2-${stem}-M6${ch ?? ''}_G19_s${start}0_e${start}5_c${start}9.nc`;
};

test('historical GOES windows surround the cursor instead of using the newest files in the hour', async () => {
    const { fetcher } = recordedBucket();
    const frames = await fetchGoesTimelineNear(CONUS, C13, new Date('2026-10-11T12:12:00Z'), { fetcher });
    assert.deepEqual(frames.map((frame) => frame.timestamp), ['20261011-120618', '20261011-121118', '20261011-121618', '20261011-122118']);
});

test('GOES cursor windows cross UTC year boundaries and join the correct MCMIP files', async () => {
    const starts = ['2026365235118', '2026365235618', '2027001000118', '2027001000618', '2027001001118', '2027001005618'];
    const objects = starts.flatMap((start) => [
        { key: key('ABI-L2-CMIPC', 'CMIPC', 'C02', start) },
        { key: key('ABI-L2-MCMIPC', 'MCMIPC', null, start) },
    ]);
    const { fetcher } = fakeBucket(objects);
    const frames = await fetchGoesTimelineNear(CONUS, C02, new Date('2027-01-01T00:00:30Z'), { fetcher });
    assert.deepEqual(frames.map((frame) => frame.timestamp), ['20261231-235118', '20261231-235618', '20270101-000118', '20270101-000618']);
    assert.ok(frames.every((frame) => parseGoesKey(frame.mcmip.key).timestamp === frame.timestamp));
});

test('parses recorded pages: keys, sizes and scan starts', () => {
    const page = parseGoesListing(fixture('list-cmipc-c13-284-12.xml'));
    assert.equal(page.objects.length, 12);
    assert.equal(page.nextToken, null);
    assert.equal(page.objects[0].size, 3970679);
    const k = parseGoesKey(page.objects[0].key);
    assert.deepEqual(k, { product: 'ABI-L2-CMIPC', stem: 'CMIPC', mode: '6', channel: 'C13', satellite: 'G19', timestamp: '20261011-120118' });
    const mc = parseGoesKey(parseGoesListing(fixture('list-mcmipc-284-12.xml')).objects[0].key);
    assert.equal(mc.channel, null, 'all-band files have no channel');
    assert.equal(mc.timestamp, '20261011-120118', "MCMIP shares the band files' scan start");
});

test('malformed and foreign keys are skipped', () => {
    for (const bad of [
        'ABI-L2-CMIPC/2026/284/12/OR_ABI-L2-CMIPC-M6C13_G19_s20262841201181_e20262841203566.nc', // no creation time
        'ABI-L2-CMIPC/2026/284/13/OR_ABI-L2-CMIPC-M6C13_G19_s20262841201181_e20262841203566_c20262841204043.nc', // hour mismatch
        'ABI-L2-CMIPC/2026/367/12/OR_ABI-L2-CMIPC-M6C13_G19_s20263671201181_e20263671203566_c20263671204043.nc', // day 367
        'ABI-L2-CMIPC/2026/284/12/OR_ABI-L2-CMIPC-M6C13_G19_s20262842501181_e20262841203566_c20262841204043.nc', // hour 25
        'ABI-L2-CMIPC/2026/284/12/', 'garbage',
    ]) assert.equal(parseGoesKey(bad), null, bad);
});

test('scan starts convert from day of year, including leap days and year ends', () => {
    assert.equal(scanTimestamp('2026284120118'), '20261011-120118');
    assert.equal(scanTimestamp('2028060000000'), '20280229-000000', 'day 60 of a leap year is Feb 29');
    assert.equal(scanTimestamp('2028366235959'), '20281231-235959');
    assert.equal(scanTimestamp('2026366000000'), null, '2026 has 365 days');
    assert.equal(hourPrefix('ABI-L2-CMIPC', new Date(Date.UTC(2028, 1, 29, 7))), 'ABI-L2-CMIPC/2028/060/07/');
    assert.equal(hourPrefix('ABI-L2-CMIPC', new Date(Date.UTC(2026, 11, 31, 23))), 'ABI-L2-CMIPC/2026/365/23/');
});

test('the file-name stem gives one small page per hour for CONUS and for each mesoscale sector', async () => {
    const { fetcher, calls } = recordedBucket();
    const now = new Date(Date.UTC(2026, 9, 11, 12, 59));
    const conus = await fetchGoesTimeline(CONUS, C13, now, { fetcher });
    assert.deepEqual(conus.map((f) => f.timestamp), ['20261011-124118', '20261011-124618', '20261011-125118', '20261011-125618']);
    assert.equal(conus[0].mcmip, null, '2 km bands never need MCMIP');
    assert.ok(calls.every((p) => p.includes('OR_ABI-L2-')), 'every listing is narrowed to the stem');

    const m1 = await fetchGoesTimeline(M1, C13, now, { fetcher });
    const m2 = await fetchGoesTimeline(M2, C13, now, { fetcher });
    assert.equal(m1.length, 4);
    assert.ok(m1.every((f) => f.band.key.includes('CMIPM1')), 'M1 keys only');
    assert.ok(m2.every((f) => f.band.key.includes('CMIPM2')), 'M2 keys only');
    assert.notDeepEqual(m1.map((f) => f.timestamp), m2.map((f) => f.timestamp), 'M2 scans about 30 s after M1');
});

test('0.5 and 1 km bands join MCMIP on scan start, and a frame without MCMIP is hidden', async () => {
    const start = (min) => `2026284${'12'}${String(min).padStart(2, '0')}18`;
    const objects = [];
    for (const min of [1, 6, 11, 16]) {
        objects.push({ key: key('ABI-L2-CMIPC', 'CMIPC', 'C02', start(min)), size: 45e6 });
        objects.push({ key: key('ABI-L2-CMIPC', 'CMIPC', 'C13', start(min)), size: 4e6 });
        if (min !== 16) objects.push({ key: key('ABI-L2-MCMIPC', 'MCMIPC', null, start(min)), size: 49e6 });
    }
    const { fetcher } = fakeBucket(objects);
    const now = new Date(Date.UTC(2026, 9, 11, 12, 20));
    const c02 = await fetchGoesTimeline(CONUS, C02, now, { fetcher });
    assert.deepEqual(c02.map((f) => f.timestamp.slice(9)), ['120118', '120618', '121118'], 'the 12:16 scan waits for its MCMIP');
    assert.ok(c02.every((f) => f.mcmip && f.mcmip.size === 49e6));
    const c13 = await fetchGoesTimeline(CONUS, C13, now, { fetcher });
    assert.equal(c13.at(-1).timestamp, '20261011-121618', 'a 2 km band does not wait for MCMIP');
    const meso = await fetchGoesTimeline(M1, C02, now, { fetcher });
    assert.deepEqual(meso, [], 'no mesoscale files in this bucket');
});

test('timelines cross hour, day-of-year and year boundaries', async () => {
    const objects = [
        { key: key('ABI-L2-CMIPC', 'CMIPC', 'C13', '2026365235118') },
        { key: key('ABI-L2-CMIPC', 'CMIPC', 'C13', '2026365235618') },
        { key: key('ABI-L2-CMIPC', 'CMIPC', 'C13', '2027001000118') },
        { key: key('ABI-L2-CMIPC', 'CMIPC', 'C13', '2027001000618') },
        { key: key('ABI-L2-CMIPC', 'CMIPC', 'C13', '2027001001118') },
    ];
    const { fetcher, calls } = fakeBucket(objects);
    const frames = await fetchGoesTimeline(CONUS, C13, new Date(Date.UTC(2027, 0, 1, 0, 12)), { fetcher });
    assert.deepEqual(frames.map((f) => f.timestamp), ['20261231-235618', '20270101-000118', '20270101-000618', '20270101-001118']);
    assert.ok(calls.some((c) => c.prefix.startsWith('ABI-L2-CMIPC/2026/365/23/')));
    assert.deepEqual(hoursBetween(new Date(Date.UTC(2028, 1, 28, 23, 30)), new Date(Date.UTC(2028, 1, 29, 1, 5))).map((d) => d.getUTCHours()), [23, 0, 1]);
    const ranged = await listScans(CONUS, C13, new Date(Date.UTC(2026, 11, 31, 23, 55)), new Date(Date.UTC(2027, 0, 1, 0, 5)), { fetcher });
    assert.deepEqual(ranged.map((f) => f.timestamp), ['20261231-235618', '20270101-000118']);
});

test('refresh lists with start-after and merges into the newest frames', async () => {
    const objects = ['2026284120118', '2026284120618', '2026284121118', '2026284121618', '2026284122118']
        .map((s) => ({ key: key('ABI-L2-CMIPC', 'CMIPC', 'C13', s) }));
    const { fetcher, calls } = fakeBucket(objects);
    const first = await fetchGoesTimeline(CONUS, C13, new Date(Date.UTC(2026, 9, 11, 12, 19)), { fetcher: fakeBucket(objects.slice(0, 4)).fetcher });
    calls.length = 0;
    const fresh = await listNewFrames(CONUS, C13, first.at(-1), new Date(Date.UTC(2026, 9, 11, 12, 24)), { fetcher });
    assert.deepEqual(fresh.map((f) => f.timestamp), ['20261011-122118']);
    assert.equal(calls[0]['start-after'], first.at(-1).band.key);
    const merged = mergeFrames(CONUS, first, fresh);
    assert.deepEqual(merged.map((f) => f.timestamp.slice(9)), ['120618', '121118', '121618', '122118']);
});

test('an empty stem listing reads the live scan mode from the bucket and retries', async () => {
    const m3 = (s) => key('ABI-L2-CMIPC', 'CMIPC', 'C13', s).replace('-M6C13', '-M3C13');
    const { fetcher, calls } = fakeBucket([{ key: m3('2026284120118') }, { key: m3('2026284121618') }]);
    const changes = [];
    const frames = await fetchGoesTimeline(CONUS, C13, new Date(Date.UTC(2026, 9, 11, 12, 20)), { fetcher, onScanModeChange: (m) => changes.push(m) });
    assert.deepEqual(changes, ['3']);
    assert.equal(frames.length, 2);
    assert.ok(calls.some((c) => c['max-keys'] === '20' && c.prefix === 'ABI-L2-CMIPC/2026/284/12/'), 'one small unfiltered page');
    assert.equal(fileStem('CMIPC', 'C13', '3'), 'OR_ABI-L2-CMIPC-M3C13_G19_');
    // Passing the detected mode back skips the detection.
    calls.length = 0;
    assert.equal((await fetchGoesTimeline(CONUS, C13, new Date(Date.UTC(2026, 9, 11, 12, 20)), { fetcher, scanMode: '3' })).length, 2);
    assert.ok(!calls.some((c) => c['max-keys'] === '20'));
});
