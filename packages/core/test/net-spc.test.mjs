import assert from 'node:assert/strict';
import test from 'node:test';
import { createSPCClient } from '@edgewarn/web-utils/net';

const watchText = `WT 0042
TORNADO WATCH PROBABILITIES
PROBABILITY TABLE:
PROB OF 2 OR MORE TORNADOES: 60%
PROB OF 1 OR MORE STRONG /EF2-EF5/ TORNADOES: 20%
ATTRIBUTE TABLE:
MAX HAIL /INCHES/: 2.5
MAX WIND GUSTS SURFACE /KNOTS/: 70
MAX TOPS /X 100 FEET/: 550
MEAN STORM MOTION VECTOR /DEGREES AND KNOTS/: 24045
PARTICULARLY DANGEROUS SITUATION: YES
$$`;

test('SPC clients configure upstream identity and validate outlook days before fetching', async () => {
    const calls = [];
    const client = createSPCClient({ baseUrl: 'https://spc.example.test/', userAgent: 'consumer/1', fetch: async (url, init) => {
        calls.push(String(url));
        assert.equal(new Headers(init.headers).get('User-Agent'), 'consumer/1');
        return new Response('');
    } });
    assert.deepEqual(await client.fetchOutlook(1, 'hail'), { type: 'FeatureCollection', features: [] });
    await client.fetchOutlook(8);
    await assert.rejects(client.fetchOutlook(3, 'wind'), /does not support/);
    assert.deepEqual(calls, [
        'https://spc.example.test/products/outlook/day1otlk_hail.lyr.geojson',
        'https://spc.example.test/products/exper/day4-8/day8prob.lyr.geojson',
    ]);
});

test('watch requests coalesce per instance, parse tables and keep source links on the configured host', async () => {
    let reads = 0;
    const client = createSPCClient({ baseUrl: 'https://spc.example.test', fetch: async () => {
        reads++;
        return new Response(watchText);
    } });
    assert.equal(client.getCachedWatchDetails(42), undefined);
    const [a, b] = await Promise.all([client.fetchWatchDetails(42), client.fetchWatchDetails(42)]);
    assert.equal(reads, 1);
    assert.equal(a, b);
    assert.equal(a.type, 'Tornado');
    assert.equal(a.probabilities.twoOrMoreTornadoes, '60%');
    assert.equal(a.probabilities.strongTornadoes, '20%');
    assert.equal(a.probabilities.tenOrMoreSevereHailEvents, null);
    assert.deepEqual(a.attributes, { maxHailInches: 2.5, maxWindGustKnots: 70, maxTopsHundredsFeet: 550,
        meanStormMotionVector: '24045', particularlyDangerousSituation: true });
    assert.equal(a.sourceUrls.productText, 'https://spc.example.test/products/watch/wwp0042.txt');
    assert.equal(client.getCachedWatchDetails(42), a);
    assert.equal(await client.fetchWatchDetails(0), null);
    assert.equal(await client.fetchWatchDetails(10000), null);
    assert.equal(reads, 1);
    const other = createSPCClient({ fetch: async () => new Response('', { status: 404 }) });
    assert.equal(other.getCachedWatchDetails(42), undefined);
    assert.equal(await other.fetchWatchDetails(42), null);
    assert.equal(other.getCachedWatchDetails(42), null);
});

test('failed watch reads are retried instead of poisoning the in-flight cache', async () => {
    let reads = 0;
    const client = createSPCClient({ fetch: async () => ++reads === 1
        ? new Response('', { status: 503 }) : new Response(watchText) });
    await assert.rejects(client.fetchWatchDetails(42), /503/);
    assert.equal((await client.fetchWatchDetails(42)).watchNumber, 42);
    assert.equal(reads, 2);
});

test('storm reports normalize quoted CSV, sort by time and expire only the owning instance cache', async () => {
    let now = 0;
    let reads = 0;
    const client = createSPCClient({ baseUrl: 'https://spc.example.test', now: () => now, fetch: async url => {
        reads++;
        assert.ok(String(url).startsWith('https://spc.example.test/climo/reports/'));
        return new Response(String(url).includes('hail')
            ? 'Time,Size,Location,County,State,Lat,Lon,Comments\n2300,175,Town,County,TX,35,-97,"Hail, large"\n0100,100,Other,County,TX,36,-98,"Said ""wow"""\n0200,100,Bad,County,TX,NaN,-98,bad'
            : 'Time,Speed,Location,County,State,Lat,Lon,Comments');
    } });
    const data = await client.fetchStormReports();
    assert.equal(data.features.length, 2);
    assert.equal(data.features[0].properties.magnitude, '1.75 in');
    assert.equal(data.features[0].properties.comments, 'Hail, large');
    assert.equal(data.features[1].properties.comments, 'Said "wow"');
    assert.equal(await client.fetchStormReports(), data);
    assert.equal(reads, 3);
    now = 5 * 60 * 1000;
    await client.fetchStormReports();
    assert.equal(reads, 6);
    await client.fetchStormReports(true);
    assert.equal(reads, 9);
});
