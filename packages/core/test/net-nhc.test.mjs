import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchCycloneForecasts as loadCycloneForecasts, cycloneColor, cycloneCategory, formatAdvisoryTime, bareStormName } from '@edgewarn/web-utils/net';

const collection = features => ({ type: 'FeatureCollection', features });
const point = properties => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [-60, 20] }, properties });

async function withFetch(mock, run) {
    const previous = globalThis.fetch;
    globalThis.fetch = mock;
    try { await run(); } finally { globalThis.fetch = previous; }
}

test('loads official cones, tracks and points in WGS84; normalizes forecast properties', async () => {
    const requests = [];
    await withFetch(async input => {
        const url = new URL(input);
        requests.push(url);
        const id = url.pathname.split('/').at(-2);
        const geometry = id === '7'
            ? { type: 'Polygon', coordinates: [[[-61, 19], [-60, 20], [-59, 19], [-61, 19]]] }
            : id === '6' ? { type: 'LineString', coordinates: [[-60, 20], [-61, 21]] }
            : { type: 'Point', coordinates: [-60, 20] };
        return Response.json(collection([{ type: 'Feature', geometry, properties: { STORMNAME: 'Hurricane Test', MAXWIND: 80, TAU: 0 } }]));
    }, async () => {
        const data = await loadCycloneForecasts();
        assert.deepEqual(data.features.map(f => f.properties.kind), ['cone', 'track', 'point']);
        assert.equal(data.features[2].properties._label, 'Hurricane Test');
        assert.equal(data.features[2].properties._color, '#fbbf24');
        assert.equal(requests.length, 3);
        for (const url of requests) {
            assert.equal(url.hostname, 'mapservices.weather.noaa.gov');
            assert.equal(url.searchParams.get('outSR'), '4326');
            assert.equal(url.searchParams.get('orderByFields'), 'objectid ASC');
        }
    });
});

test('follows ArcGIS transfer limits without dropping additional forecast points', async () => {
    await withFetch(async input => {
        const url = new URL(input);
        if (!url.pathname.includes('/5/')) return Response.json(collection([]));
        if (url.searchParams.get('resultOffset') === '0') return Response.json({ ...collection([point({ tau: 0 })]), exceededTransferLimit: true });
        assert.equal(url.searchParams.get('resultOffset'), '1');
        return Response.json(collection([point({ tau: 12, datelbl: '12 PM Fri' })]));
    }, async () => {
        const data = await loadCycloneForecasts();
        assert.equal(data.features.length, 2);
        assert.equal(data.features[1].properties._label, '12 PM Fri');
    });
});

test('an empty successful feed means no active forecasts', async () => {
    await withFetch(async () => Response.json(collection([])), async () => {
        assert.deepEqual(await loadCycloneForecasts(), collection([]));
    });
});

test('normalizes a custom MapServer base URL', async () => {
    const paths = [];
    await withFetch(async input => {
        paths.push(new URL(input).pathname);
        return Response.json(collection([]));
    }, async () => {
        await loadCycloneForecasts(undefined, { baseUrl: 'https://example.com/MapServer///' });
    });
    assert.deepEqual(paths.sort(), ['/MapServer/5/query', '/MapServer/6/query', '/MapServer/7/query']);
});

test('upstream HTTP, ArcGIS and malformed-geometry errors are not converted to empty forecasts', async () => {
    for (const response of [
        () => new Response('Unavailable', { status: 503 }),
        () => Response.json({ error: { message: 'Unavailable' } }),
        () => Response.json(collection([{ type: 'Feature', geometry: null, properties: {} }])),
    ]) {
        await withFetch(async () => response(), async () => {
            await assert.rejects(loadCycloneForecasts());
        });
    }
});

test('wind colors follow knot thresholds and distinguish missing values', () => {
    for (const [wind, color] of [[33, '#a3e635'], [34, '#38bdf8'], [63, '#38bdf8'], [64, '#fbbf24'], [95, '#fbbf24'], [96, '#fb7185'], [null, '#94a3b8'], [9999, '#94a3b8']]) {
        assert.equal(cycloneColor(wind), color);
    }
});

test('categories follow Saffir-Simpson knot thresholds and agree with tier colors', () => {
    for (const [wind, label, step] of [[20, 'Tropical depression', 0], [34, 'Tropical storm', 1], [64, 'Category 1 hurricane', 2], [83, 'Category 2 hurricane', 3], [96, 'Category 3 hurricane', 4], [113, 'Category 4 hurricane', 5], [137, 'Category 5 hurricane', 6]]) {
        assert.deepEqual([cycloneCategory(wind).label, cycloneCategory(wind).step], [label, step]);
    }
    assert.equal(cycloneCategory(null), null);
    assert.equal(cycloneCategory(9999), null);
    const colors = { depression: '#a3e635', storm: '#38bdf8', hurricane: '#fbbf24', major: '#fb7185' };
    for (const wind of [20, 34, 64, 83, 96, 150]) assert.equal(colors[cycloneCategory(wind).tier], cycloneColor(wind));
});

test('advisory times gain a colon', () => {
    assert.equal(formatAdvisoryTime('1100 AM PDT Sat Oct 10 2026'), '11:00 AM PDT Sat Oct 10 2026');
    assert.equal(formatAdvisoryTime(undefined), '');
});

test('storm names drop the leading storm type', () => {
    for (const [input, name] of [['Tropical Storm Rachel', 'Rachel'], ['Hurricane Simon', 'Simon'], ['Post-Tropical Cyclone Ida', 'Ida'], ['Rachel', 'Rachel'], ['Hurricane', 'Hurricane'], [undefined, '']]) {
        assert.equal(bareStormName(input), name);
    }
});
