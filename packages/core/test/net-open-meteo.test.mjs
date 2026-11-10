import assert from 'node:assert/strict';
import test from 'node:test';
import { OPEN_METEO_CACHE_TTL_MS, createOpenMeteoClient, fetchOpenMeteoHourlyForecast } from '@edgewarn/web-utils/net';

const body = (extra = {}) => JSON.stringify({ timezone: 'UTC', hourly: { time: [1789142400], temperature_2m: [72], weather_code: [0], is_day: [1] }, ...extra });

test('Open-Meteo hourly client requests local forecast data and preserves UTC instants', async () => {
    let requestedUrl;
    const fetch = async (url) => {
        requestedUrl = new URL(url);
        return new Response(JSON.stringify({
            timezone: 'America/New_York',
            hourly: {
                time: [1789142400, 1789146000], temperature_2m: [72.4, null], relative_humidity_2m: [65, 80], precipitation_probability: [0, 60],
                wind_speed_10m: [5.5, 8], wind_direction_10m: [270, 315], weather_code: [0, 61], is_day: [1, 0],
            },
        }), { status: 200 });
    };
    const result = await fetchOpenMeteoHourlyForecast(40.7, -74, undefined, 48, { fetch });
    assert.equal(requestedUrl.origin, 'https://api.open-meteo.com');
    assert.equal(requestedUrl.searchParams.get('forecast_hours'), '48');
    assert.equal(requestedUrl.searchParams.get('timeformat'), 'unixtime');
    assert.equal(requestedUrl.searchParams.get('timezone'), 'auto');
    assert.equal(requestedUrl.searchParams.get('temperature_unit'), 'fahrenheit');
    assert.equal(requestedUrl.searchParams.get('wind_speed_unit'), 'mph');
    assert.match(requestedUrl.searchParams.get('hourly'), /relative_humidity_2m/);
    assert.equal(result.timeZone, 'America/New_York');
    assert.equal(result.hours[0].time, new Date(1789142400 * 1000).toISOString());
    assert.equal(result.hours[0].precipitationProbability, 0);
    assert.equal(result.hours[0].humidity, 65);
    assert.equal(result.hours[1].temperature, null);
    assert.equal(result.hours[1].isDay, false);
});

test('rejects an incomplete response and invalid coordinates, and takes a base URL', async () => {
    const fetch = async () => new Response(JSON.stringify({ timezone: 'UTC', hourly: { time: [] } }), { status: 200 });
    await assert.rejects(fetchOpenMeteoHourlyForecast(40.7, -74, undefined, 48, { fetch }), /incomplete hourly forecast/);
    await assert.rejects(fetchOpenMeteoHourlyForecast(91, 0), /Invalid forecast coordinates/);
    let origin;
    await fetchOpenMeteoHourlyForecast(1, 2, undefined, 48, { fetch: async (u) => { origin = new URL(u).origin; return new Response(body()); }, baseUrl: 'https://proxy.example.test/forecast' });
    assert.equal(origin, 'https://proxy.example.test');
});

test('an instance shares requests and refreshes only after 30 minutes; instances share nothing', async () => {
    let calls = 0, now = 1_800_000_000_000;
    const fetch = async () => { calls += 1; return new Response(body()); };
    const client = createOpenMeteoClient({ fetch, now: () => now });
    const [first, simultaneous] = await Promise.all([client.getHourlyForecast(12.3441, 56.7841), client.getHourlyForecast(12.3442, 56.7842)]);
    assert.equal(calls, 1);
    assert.equal(first, simultaneous);
    assert.equal(await client.getHourlyForecast(12.3441, 56.7841), first);
    assert.equal(calls, 1);
    await client.getHourlyForecast(12.346, 56.7841);
    assert.equal(calls, 2, 'a different location requires its own request');
    now = Date.parse(first.fetchedAt) + OPEN_METEO_CACHE_TTL_MS;
    await client.getHourlyForecast(12.3441, 56.7841);
    assert.equal(calls, 3);
    await createOpenMeteoClient({ fetch }).getHourlyForecast(12.3441, 56.7841);
    assert.equal(calls, 4, 'a second instance has its own cache');
});

const storage = () => {
    const saved = new Map();
    return { saved, get length() { return saved.size; }, key: (i) => [...saved.keys()][i] ?? null, getItem: (k) => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v), removeItem: (k) => saved.delete(k) };
};

test('injected storage lets a new instance reuse the saved response, and old or foreign entries are pruned', async () => {
    const store = storage();
    let calls = 0;
    const fetch = async () => { calls += 1; return new Response(body({ timezone: 'America/New_York' })); };
    const first = await createOpenMeteoClient({ fetch, storage: store }).getHourlyForecast(44.444, -72.222);
    assert.equal(calls, 1);
    assert.equal(store.saved.size, 1);
    const reloaded = createOpenMeteoClient({ fetch, storage: store });
    assert.deepEqual(await reloaded.getHourlyForecast(44.444, -72.222), first);
    assert.equal(calls, 1);
    await reloaded.getHourlyForecast(44.445, -72.222);
    assert.equal(calls, 2, 'a different location cannot use the saved response');
    store.saved.set('edgewarn-open-meteo-hourly-v1:old', JSON.stringify(first));
    store.saved.set('edgewarn-open-meteo-hourly-v3:1.000,1.000', '{not json');
    await reloaded.getHourlyForecast(44.444, -72.222);
    assert.deepEqual([...store.saved.keys()].filter((k) => k.includes('v1:') || k.includes('1.000,1.000')), []);
});

test('without storage, or with storage that throws, forecasts still work from memory', async () => {
    const fetch = async () => new Response(body());
    const broken = { length: 1, key: () => { throw new Error('blocked'); }, getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => {} };
    for (const store of [null, undefined, broken]) {
        const client = createOpenMeteoClient({ fetch, storage: store });
        assert.ok((await client.getHourlyForecast(10, 10)).hours.length > 0);
    }
});
