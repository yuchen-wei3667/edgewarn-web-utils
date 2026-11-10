import assert from 'node:assert/strict';
import test from 'node:test';
import { createWPCClient, createSPCClient, createReportsClient, DEFAULT_NWS_USER_AGENT } from '@edgewarn/web-utils/net';

const empty = { type: 'FeatureCollection', features: [] };
test('WPC uses independently configurable endpoints and request identity', async () => {
    const urls = [];
    const client = createWPCClient({ hazardsUrl: 'https://wpc.example.test/ero/', wssiUrl: 'https://wpc.example.test/wssi/', userAgent: null,
        fetch: async (url, init) => {
            urls.push(String(url));
            assert.equal(new Headers(init.headers).get('User-Agent'), null);
            return Response.json(empty);
        } });
    assert.deepEqual(await client.fetchEro(5), empty);
    assert.deepEqual(await client.fetchWssi(3), empty);
    assert.deepEqual(urls, ['https://wpc.example.test/ero/4/query?where=1%3D1&outFields=*&f=geojson',
        'https://wpc.example.test/wssi/3/query?where=objectid%3E0&outFields=*&f=geojson']);
    await assert.rejects(createWPCClient({ fetch: async () => Response.json({ error: { message: 'bad query' } }) }).fetchWssi(1), /bad query/);
});

test('surface analysis chooses nearest ASUS02 chart, coalesces loads and expires the listing', async () => {
    let now = Date.UTC(2026, 10, 9, 15);
    const urls = [];
    const client = createWPCClient({ productsUrl: 'https://nws.example.test/products', now: () => now,
        fetch: async (url, init) => {
            urls.push(String(url));
            assert.equal(new Headers(init.headers).get('User-Agent'), DEFAULT_NWS_USER_AGENT);
            return String(url).endsWith('/types/COD') ? Response.json({ '@graph': [
                { id: 'old', wmoCollectiveId: 'ASUS02', issuanceTime: '2026-11-09T12:00:00Z' },
                { id: 'new', wmoCollectiveId: 'ASUS02', issuanceTime: '2026-11-09T15:00:00Z' },
                { id: 'ignored', wmoCollectiveId: 'ASUS01', issuanceTime: '2026-11-09T15:00:00Z' },
            ] }) : Response.json({ productText: 'HIGHS 1036 4371107\n$$' });
        } });
    const [a, b] = await Promise.all([client.fetchSurfaceAnalysis(), client.fetchSurfaceAnalysis()]);
    assert.equal(a, b);
    assert.equal(a.features[0].properties.pressure, 1036);
    assert.deepEqual(urls, ['https://nws.example.test/products/types/COD', 'https://nws.example.test/products/new']);
    await client.fetchSurfaceAnalysis('20261109-120000');
    assert.equal(urls.at(-1), 'https://nws.example.test/products/old');
    now += 2 * 60 * 1000;
    await client.fetchSurfaceAnalysis();
    assert.equal(urls.length, 4);
    const other = createWPCClient({ fetch: async () => { throw Error('offline'); } });
    assert.deepEqual(await other.fetchSurfaceAnalysis(), empty);
});

test('PWPF adds metadata before injected geometry processing and preserves successful snow layers', async () => {
    let processed = 0;
    const client = createWPCClient({ baseUrl: 'https://wpc.example.test/pwpf',
        fetch: async url => String(url).includes('/2/query') ? new Response('', { status: 503 })
            : Response.json({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: null }] }),
        postProcess: data => {
            processed++;
            assert.equal(data.features[0].properties.day, 1);
            return data;
        } });
    const snow = await client.fetchAllSnowProbabilities(1);
    assert.deepEqual(snow.features.map(f => f.properties.threshold), ['04', '12']);
    assert.equal(snow.features[0].properties.type, 'snow');
    const ice = await client.fetchIceProbability(1);
    assert.equal(ice.features[0].properties.type, 'ice');
    assert.equal(processed, 3);
});

test('public-feed requests reject insecure URLs before calling injected fetch', async () => {
    const fetch = async () => { throw Error('must not fetch'); };
    await assert.rejects(createSPCClient({ baseUrl: 'http://spc.example.test', fetch }).fetchOutlook(1), /https/);
    await assert.rejects(createReportsClient({ lsrUrl: 'http://iem.example.test', fetch }).fetchLocalStormReports({}), /https/);
});

test('the configured client timeout aborts injected fetch and preserves cancellation reasons', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let signal;
    const client = createSPCClient({ timeoutMs: 20, fetch: async (_url, init) => {
        signal = init.signal;
        return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    } });
    const rejected = assert.rejects(client.fetchOutlook(1), { name: 'TimeoutError' });
    t.mock.timers.tick(20);
    await rejected;
    assert.equal(signal.aborted, true);
});
