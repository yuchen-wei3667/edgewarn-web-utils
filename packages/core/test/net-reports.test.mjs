import assert from 'node:assert/strict';
import test from 'node:test';
import { createReportsClient } from '@edgewarn/web-utils/net';

test('LSR builds a padded time/viewport query and normalizes only valid point reports', async () => {
    const client = createReportsClient({ lsrUrl: 'https://iem.example.test/lsr', userAgent: 'consumer/1', fetch: async (url, init) => {
        const query = new URL(url);
        assert.equal(query.origin + query.pathname, 'https://iem.example.test/lsr');
        assert.equal(query.searchParams.get('sts'), '2026-11-09T11:45:00Z');
        assert.equal(query.searchParams.get('ets'), '2026-11-09T12:15:00Z');
        assert.equal(query.searchParams.get('west'), '-97.350');
        assert.equal(query.searchParams.get('north'), '36.350');
        assert.equal(new Headers(init.headers).get('User-Agent'), 'consumer/1');
        return Response.json({ features: [null,
            { geometry: { type: 'LineString', coordinates: [-97, 35] } },
            { geometry: { type: 'Point', coordinates: ['bad', 35] } },
            { id: 123, geometry: { type: 'Point', coordinates: ['-97', '35'] },
                properties: { magf: '1.75', typetext: 'HAIL', remark: 'large hail' } },
        ] });
    } });
    const result = await client.fetchLocalStormReports({ currentTimestamp: '20261109-120000', windowMinutes: 1,
        bounds: { west: -97, east: -96, south: 35, north: 36 } });
    assert.equal(result.features.length, 1);
    assert.equal(result.features[0].id, '123');
    assert.equal(result.features[0].properties.magf, 1.75);
    assert.equal(result.features[0].properties.unit, null);
    assert.deepEqual(result.features[0].geometry.coordinates, [-97, 35]);
});

test('LSR uses lookback without a valid cursor and propagates HTTP failures', async () => {
    let reads = 0;
    const client = createReportsClient({ fetch: async url => {
        reads++;
        assert.equal(new URL(url).searchParams.get('hours'), '6');
        return new Response('', { status: 503 });
    } });
    await assert.rejects(client.fetchLocalStormReports({ currentTimestamp: 'invalid' }), /503/);
    assert.equal(reads, 1);
});

test('CoCoRaHS retries query variants then falls back one day and normalizes aliases', async t => {
    t.mock.method(console, 'warn', () => {});
    const urls = [];
    const client = createReportsClient({ cocorahsUrl: 'https://iem.example.test/coco', fetch: async url => {
        const parsed = new URL(url);
        urls.push(parsed);
        if (urls.length === 1) return new Response('', { status: 400 });
        if (parsed.searchParams.get('date') === '2026-11-09') return Response.json({ features: [] });
        return Response.json({ features: [null, { id: 'NY-42', geometry: { type: 'Point', coordinates: [-74, 41] },
            properties: { station_name: 'Station', precip24: '0.50', snow_in: 'T', snow_depth: 2, report_hour: '7' } }] });
    } });
    const result = await client.fetchCoCoRaHSReports('20261109-120000');
    assert.equal(urls.length, 3);
    assert.equal(urls[2].searchParams.get('dt'), '2026-11-08');
    assert.equal(result.features.length, 1);
    assert.deepEqual(result.features[0].properties, { stationId: 'NY-42', stationName: 'Station', network: 'COCORAHS',
        valid: '', precipitation24h: 0.5, snow24h: null, snowDepth: 2, reportHourLocal: 7 });
});

test('CoCoRaHS uses the injected clock when the caller omits the cursor', async () => {
    const urls = [];
    const client = createReportsClient({ now: () => Date.UTC(2026, 10, 9, 12), fetch: async url => {
        urls.push(String(url));
        return Response.json({ features: [{ geometry: { type: 'Point', coordinates: [-74, 41] } }] });
    } });
    assert.equal((await client.fetchCoCoRaHSReports()).features.length, 1);
    assert.equal(urls.length, 1);
    assert.equal(new URL(urls[0]).searchParams.get('dt'), '2026-11-09');
});

test('CoCoRaHS exhausts both report days before rejecting an unavailable feed', async t => {
    t.mock.method(console, 'warn', () => {});
    let reads = 0;
    const client = createReportsClient({ fetch: async () => { reads++; return Response.json({ error: 'offline' }); } });
    await assert.rejects(client.fetchCoCoRaHSReports('20261109-120000'), /no valid response/);
    assert.equal(reads, 8);
});
