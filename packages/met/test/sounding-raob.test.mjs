import assert from 'node:assert/strict';
import test from 'node:test';

import {
    RaobError, distanceKm, fetchRaobColumn, fetchRaobStations, isUsRaobStation, nearestRaobStations, parseRaobColumn, parseRaobStations,
    raobLaunchChoices, raobPlace, raobProfileUrl, raobTimestamp, recentRaobLaunches, windOnlyColumn,
} from '@edgewarn/web-utils/met';

// Shaped like the IEM replies (checked against the live service on 2026-10-30); trimmed to a few levels.
const STATIONS = {
    type: 'FeatureCollection',
    features: [
        { type: 'Feature', id: 'KOKX', properties: { sname: 'Brookhaven', online: true }, geometry: { type: 'Point', coordinates: [-72.87, 40.87] } },
        { type: 'Feature', id: '_ALY', properties: { sname: 'Albany Area -- KALB KALY', online: true }, geometry: { type: 'Point', coordinates: [-73.83, 42.69] } },
        { type: 'Feature', id: 'KOUN', properties: { sname: 'Norman  OK/US', online: true }, geometry: { type: 'Point', coordinates: [-97.44, 35.18] } },
        { type: 'Feature', id: 'KOFF', properties: { sname: 'Retired', online: false }, geometry: { type: 'Point', coordinates: [-95, 41] } },
        { type: 'Feature', id: 'KBAD', properties: { sname: 'No point' }, geometry: null },
    ],
};

const REPLY = {
    profiles: [{
        station: 'KOKX', valid: '2026-10-29T12:00:00Z',
        profile: [
            { pres: 1000.0, hght: 213.0, tmpc: null, dwpc: null, drct: null, sknt: null }, // underground mandatory level
            { pres: 1024.0, hght: 20.0, tmpc: 2.4, dwpc: 2.4, drct: 0.0, sknt: 0.0 },
            { pres: 925.0, hght: 864.0, tmpc: 9.0, dwpc: 12.0, drct: 270.0, sknt: 20.0 }, // dewpoint above temperature
            { pres: 925.0, hght: 864.0, tmpc: 9.0, dwpc: 4.8, drct: 270.0, sknt: 20.0 }, // repeated pressure
            { pres: 850.0, hght: 1500.0, tmpc: 5.0, dwpc: null, drct: null, sknt: null }, // no moisture, no wind
            { pres: 700.0, hght: 3100.0, tmpc: -3.0, dwpc: -10.0, drct: 180.0, sknt: 40.0 },
        ],
    }],
};

test('the station list keeps online stations with a point and tidies the names', () => {
    const stations = parseRaobStations(STATIONS);
    assert.deepEqual(stations.map((s) => s.id), ['KOKX', '_ALY', 'KOUN']);
    assert.equal(stations[1].name, 'Albany Area');
    assert.equal(stations[2].name, 'Norman OK/US');
    assert.deepEqual(parseRaobStations(null), []);
    assert.deepEqual(parseRaobStations({ features: 'x' }), []);
});

test('the nearest station to a point is found by great-circle distance, nearest first', () => {
    const near = nearestRaobStations(parseRaobStations(STATIONS), 41.14, -74.19, 2);
    assert.deepEqual(near.map((n) => n.station.id), ['KOKX', '_ALY']);
    assert.ok(near[0].km > 100 && near[0].km < 160, String(near[0].km));
    assert.ok(Math.abs(distanceKm(0, 0, 0, 1) - 111.19) < 0.1);
});

test('the default launch is the 00 or 12 UTC one nearest the valid time, with 06 and 18 UTC after it', () => {
    const valid = Date.UTC(2026, 9, 30, 17, 0);
    const choices = raobLaunchChoices(valid);
    assert.equal(choices.length, 4);
    assert.equal(choices[0].ms, Date.UTC(2026, 9, 30, 12));
    assert.equal(choices[0].main, true);
    assert.equal(choices[1].ms, Date.UTC(2026, 9, 30, 18));
    assert.equal(choices[1].main, false);
    // 23 UTC is nearer to the next 00 UTC.
    assert.equal(raobLaunchChoices(Date.UTC(2026, 9, 30, 23))[0].ms, Date.UTC(2026, 9, 31, 0));
});

test('the request is the station and a UTC YYYYMMDDHH00 stamp', () => {
    assert.equal(raobTimestamp(Date.UTC(2026, 9, 29, 12)), '202610291200');
    assert.equal(raobProfileUrl('KOKX', Date.UTC(2026, 9, 29, 12)), 'https://mesonet.agron.iastate.edu/json/raob.py?ts=202610291200&station=KOKX');
    assert.match(raobProfileUrl('_ABR', 0), /station=_ABR$/);
});

test('a reply becomes a column: rows without a temperature dropped, falling pressure, no repeats, gaps as NaN', () => {
    const col = parseRaobColumn(REPLY, 123);
    assert.ok(col);
    assert.equal(col.validMs, 123);
    assert.deepEqual(Array.from(col.p), [1024, 925, 850, 700]);
    assert.equal(col.surface.p, 1024);
    assert.equal(col.surface.z, 20);
    assert.equal(col.td[1], 9); // the dewpoint is lowered to the temperature
    assert.ok(Number.isNaN(col.td[2]));
    assert.ok(Number.isNaN(col.u[2]) && Number.isNaN(col.v[2]));
    // 270 degrees at 20 kt blows toward the east: u positive, v about 0.
    assert.ok(Math.abs(col.u[1] - 20 * 0.514444) < 1e-3);
    assert.ok(Math.abs(col.v[1]) < 1e-3);
    // 180 degrees (from the south) blows toward the north.
    assert.ok(col.v[3] > 0 && Math.abs(col.u[3]) < 1e-3);
});

test('a reply with no profile, or fewer than two usable levels, is null', () => {
    assert.equal(parseRaobColumn({ profiles: [] }, 0), null);
    assert.equal(parseRaobColumn(null, 0), null);
    assert.equal(parseRaobColumn({ profiles: [{ profile: [{ pres: 1000, hght: 0, tmpc: null }] }] }, 0), null);
    assert.equal(parseRaobColumn({ profiles: [{ profile: [{ pres: 1000, hght: 0, tmpc: 10 }] }] }, 0), null);
});

test('the wind-only column keeps the levels that have a wind, for the hodograph', () => {
    const col = parseRaobColumn(REPLY, 0);
    const winds = windOnlyColumn(col);
    assert.ok(winds);
    assert.deepEqual(Array.from(winds.p), [1024, 925, 700]);
    assert.ok(winds.u.every(Number.isFinite));
    assert.equal(windOnlyColumn({ ...col, u: Float32Array.from([NaN, NaN, NaN, 1]) }), null);
});

test('only US sites are offered: lower 48, Puerto Rico, Alaska, Hawaii; not areas or foreign sites', () => {
    const ids = ['KOUN', 'PANC', 'PHLI', 'TJSJ', '_ABR', 'CYYZ', 'MMMX', 'KOUN2'];
    assert.deepEqual(ids.filter((id) => isUsRaobStation({ id })), ['KOUN', 'PANC', 'PHLI', 'TJSJ']);
});

test('a station name splits into place and state', () => {
    assert.deepEqual(raobPlace({ name: 'Norman OK/US' }), { place: 'Norman', region: 'OK' });
    assert.deepEqual(raobPlace({ name: 'Albuquerq/Krtlnd NM/US' }), { place: 'Albuquerq/Krtlnd', region: 'NM' });
    assert.deepEqual(raobPlace({ name: 'KODIAK' }), { place: 'Kodiak', region: null });
});

test('recent launches are the 00 and 12 UTC ones, newest first, with the unposted flagged', () => {
    const now = Date.UTC(2026, 10, 2, 13, 0);
    const launches = recentRaobLaunches(now, 2);
    assert.deepEqual(launches.map((l) => l.ms), [Date.UTC(2026, 10, 2, 12), Date.UTC(2026, 10, 2, 0), Date.UTC(2026, 10, 1, 12), Date.UTC(2026, 10, 1, 0)]);
    assert.deepEqual(launches.map((l) => l.posted), [false, true, true, true]);
    // Before 12 UTC the day's 12 UTC launch has not happened.
    assert.equal(recentRaobLaunches(Date.UTC(2026, 10, 2, 5), 1).length, 1);
});

/** `fetchWithTimeout` calls the global fetch, so the network tests swap it for the length of one test. */
async function withFetch(handler, run) {
    const original = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init) => { calls.push({ url: String(url), signal: init?.signal }); return handler(String(url)); };
    try { return await run(calls); } finally { globalThis.fetch = original; }
}

test('the station list and a launch are read from the IEM through fetchWithTimeout', async () => {
    const ms = Date.UTC(2026, 10, 2, 12);
    await withFetch((url) => (url.includes('RAOB.geojson') ? Response.json(STATIONS) : Response.json({ profiles: [{ profile: [
        { pres: 1000, hght: 100, tmpc: 20, dwpc: 10, drct: 180, sknt: 10 }, { pres: 850, hght: 1500, tmpc: 10, dwpc: 5, drct: 200, sknt: 20 } ] }] })), async (calls) => {
        assert.ok((await fetchRaobStations()).length > 0);
        const column = await fetchRaobColumn('KOUN', ms);
        assert.equal(column.p.length, 2);
        assert.equal(calls[1].url, raobProfileUrl('KOUN', ms));
        assert.ok(calls.every((c) => c.signal instanceof AbortSignal), 'a timeout signal is attached');
    });
});

test('network and empty failures are told apart, and the URLs are overridable', async () => {
    await withFetch(() => new Response('', { status: 503 }), async () => {
        await assert.rejects(fetchRaobStations(), (e) => e instanceof RaobError && e.kind === 'network' && /503/.test(e.message));
        await assert.rejects(fetchRaobColumn('KOUN', 0), (e) => e instanceof RaobError && e.kind === 'network');
    });
    await withFetch(() => Response.json({ profiles: [{ profile: [] }] }), async () => {
        await assert.rejects(fetchRaobColumn('KOUN', 0), (e) => e instanceof RaobError && e.kind === 'empty');
    });
    await withFetch(() => Response.json({ features: [] }), async () => {
        await assert.rejects(fetchRaobStations(), /came back empty/);
    });
    await withFetch(() => Response.json(STATIONS), async (calls) => {
        await fetchRaobStations(undefined, 'https://example.test/stations');
        assert.equal(calls[0].url, 'https://example.test/stations');
    });
    assert.equal(raobProfileUrl('KOUN', Date.UTC(2026, 10, 2, 12), 'https://example.test/raob'), 'https://example.test/raob?ts=202611021200&station=KOUN');
});
