import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    fetchStormTrack, intensityCategory, listHafsStorms, listingUrl, parseHafsStats, parseStormListing, positionAt, recentCycles, statsUrl, stormFromKey,
} from '../dist/tracks/hafs.js';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'hafs');
const STATS = readFileSync(path.join(FIX, '22e.2026102612.hfsa.grib.stats.short'), 'utf8');
const LISTING = readFileSync(path.join(FIX, 'listing-hfsa-20261026-12.xml'), 'utf8');
const INIT = Date.UTC(2026, 9, 26, 12);

test('stats.short parses to 3-hourly points with the valid time from the run', () => {
    const { points, skipped } = parseHafsStats(STATS, INIT);
    assert.equal(skipped, 0);
    assert.equal(points.length, 43);
    assert.deepEqual(points[0], { leadMinutes: 0, validMs: INIT, lat: 15.4, lon: -105.5, minPressureHpa: 997, maxWindKt: 55 });
    assert.equal(points[1].leadMinutes, 180);
    assert.equal(points.at(-1).leadMinutes, 126 * 60);
});

test('a truncated or malformed file keeps what parses and counts the rest', () => {
    const cut = STATS.split('\n').slice(0, 3).join('\n') + '\nHOUR:  9.0  LONG: -106.20  LAT:  15.50  MIN PR';
    const { points, skipped } = parseHafsStats(`${cut}\nnot a line\n`, INIT);
    assert.equal(points.length, 3);
    assert.equal(skipped, 2);
});

test('a fill value becomes null, and longitude east of 180 wraps', () => {
    const { points } = parseHafsStats('HOUR:  0.0  LONG:  190.00  LAT:  10.00  MIN PRESS (hPa): -999.00   MAX SURF WIND (KNOTS): -999.00\n', INIT);
    assert.equal(points[0].lon, -170);
    assert.equal(points[0].minPressureHpa, null);
    assert.equal(points[0].maxWindKt, null);
});

test('storm ids, basins and URLs come from the file name and round-trip', () => {
    const s = stormFromKey('hfsa/20261026/12/22e.2026102612.hfsa.grib.stats.short');
    assert.deepEqual(s, { number: '22', basin: 'e', id: '22e', model: 'hfsa', initMs: INIT });
    assert.equal(statsUrl(s), 'https://noaa-nws-hafs-pds.s3.amazonaws.com/hfsa/20261026/12/22e.2026102612.hfsa.grib.stats.short');
    assert.equal(stormFromKey('hfsa/20261026/12/parent.atm.f000.grb2'), null);
    assert.equal(stormFromKey('hfsa/20261026/12/22e.2026102612.hfsa.stats.tpc'), null);
});

test('a bucket listing names its storms', () => {
    assert.deepEqual(parseStormListing(LISTING).map((s) => s.id), ['02b', '03c', '22e']);
});

test('cycles are the last 6-hourly ones, newest first', () => {
    assert.deepEqual(recentCycles(Date.UTC(2026, 9, 26, 14, 30), 3), [Date.UTC(2026, 9, 26, 12), Date.UTC(2026, 9, 26, 6), Date.UTC(2026, 9, 26, 0)]);
    assert.match(listingUrl('hfsb', INIT), /prefix=hfsb\/20261026\/12\/&max-keys=1000$/);
});

test('active storms keep the newest run of each, and a failed listing is counted', async () => {
    const older = LISTING.replaceAll('20261026/12', '20261026/06').replaceAll('2026102612', '2026102606');
    const fetchFn = async (url) => {
        if (url.includes('hfsb')) throw new Error('offline');
        if (url.includes('/06/')) return { ok: true, text: async () => older };
        if (url.includes('/12/')) return { ok: true, text: async () => LISTING };
        return { ok: false, status: 404 };
    };
    const { storms, failed } = await listHafsStorms(fetchFn, Date.UTC(2026, 9, 26, 13), 2);
    assert.deepEqual(storms.map((s) => `${s.model}:${s.id}@${new Date(s.initMs).getUTCHours()}`), ['hfsa:02b@12', 'hfsa:03c@12', 'hfsa:22e@12']);
    assert.equal(failed, 2, 'both hfsb cycles failed');
});

test('a track is fetched and a bad status is an error', async () => {
    const storm = stormFromKey('hfsa/20261026/12/22e.2026102612.hfsa.grib.stats.short');
    const track = await fetchStormTrack(async () => ({ ok: true, text: async () => STATS }), storm);
    assert.equal(track.points.length, 43);
    await assert.rejects(fetchStormTrack(async () => ({ ok: false, status: 404 }), storm), /404/);
});

test('intensity categories follow the Saffir-Simpson wind bounds', () => {
    const at = (kt) => intensityCategory(kt);
    assert.deepEqual([33, 34, 63, 64, 82, 83, 95, 96, 112, 113, 136, 137].map(at), ['td', 'ts', 'ts', '1', '1', '2', '2', '3', '3', '4', '4', '5']);
    assert.equal(at(null), null);
});

test('position is interpolated between points, and absent outside the track', () => {
    const { points } = parseHafsStats(STATS, INIT);
    const mid = positionAt(points, INIT + 90 * 60_000);
    assert.ok(Math.abs(mid.lon - (-105.55)) < 1e-9 && Math.abs(mid.lat - 15.4) < 1e-9);
    assert.deepEqual(positionAt(points, INIT), { lat: 15.4, lon: -105.5 });
    assert.equal(positionAt(points, INIT - 1), null);
    assert.equal(positionAt(points, points.at(-1).validMs + 1), null);
    const across = positionAt([{ validMs: 0, lat: 0, lon: 179 }, { validMs: 2, lat: 0, lon: -179 }], 1);
    assert.equal(Math.abs(across.lon), 180);
});
