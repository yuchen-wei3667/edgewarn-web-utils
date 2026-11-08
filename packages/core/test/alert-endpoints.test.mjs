import test from 'node:test';
import assert from 'node:assert/strict';
import { NWSAPI, WWAAPI, setNwsUserAgent, EdgeWARNAPI } from '@edgewarn/web-utils/net';

const response = body => ({ ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: async () => body });
const base = 'https://mapservices.weather.noaa.gov/eventdriven/rest/services/WWA/watch_warn_adv/MapServer/1/query?f=geojson&outFields=phenom%2Csig%2Cwfo%2Ccap_id&returnGeometry=true&inSR=4326';

test('NWS region and ID endpoints encode values and use configured headers', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => { calls.push([url, options]); return response({ features: [] }); });
  setNwsUserAgent('alert-tests/1.0');
  try {
    for (const kind of ['area', 'region', 'zone']) {
      await NWSAPI.getRegionAlerts({ [kind]: ['TX', 'OK'] });
      assert.equal(calls.at(-1)[0], `https://api.weather.gov/alerts/active?${kind}=TX%2COK`);
    }
    await NWSAPI.getAlertById('a/b?c');
    assert.equal(calls.at(-1)[0], 'https://api.weather.gov/alerts/a%2Fb%3Fc');
    assert.ok(calls.every(([, o]) => o.headers['User-Agent'] === 'alert-tests/1.0'));
    for (const value of [{ area: [] }, { zone: [''] }, { region: null }, { bbox: [0,0,1,1] }, { wfo: ['KFWD'] }, { area: ['TX'], zone: ['TXC001'] }]) await assert.rejects(NWSAPI.getRegionAlerts(value));
    await assert.rejects(NWSAPI.getAlertById(' '));
    assert.equal(calls.length, 4);
  } finally { setNwsUserAgent('edgewarn-core (https://github.com/yuchen-wei3667/edgewarn-web-utils)'); }
});

test('WWA sends exact point, envelope and WFO queries; errors never return partial results', async t => {
  const calls = [];
  let body = { type: 'FeatureCollection', features: [] };
  let ok = true;
  t.mock.method(globalThis, 'fetch', async (url, options) => { calls.push([url, options]); return { ...response(body), ok, status: 503 }; });
  await WWAAPI.getAlerts(35, -97);
  assert.equal(calls.at(-1)[0], `${base}&geometry=-97%2C35&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects`);
  await WWAAPI.getRegionAlerts({ bbox: [-100, 30, -90, 40] });
  assert.equal(calls.at(-1)[0], `${base}&geometry=-100%2C30%2C-90%2C40&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects`);
  await WWAAPI.getRegionAlerts({ wfo: ['KFWD', 'KOUN'] });
  assert.equal(calls.at(-1)[0], `${base}&where=wfo+IN+%28%27KFWD%27%2C%27KOUN%27%29`);
  for (const region of [{ wfo: ["KFWD' OR 1=1"] }, { wfo: ['fwd'] }, { wfo: [] }, { area: ['TX'] }, { zone: ['TXZ001'] }, { region: ['GM'] }, { bbox: [10,0,-10,1] }, { bbox: [0,0,NaN,1] }]) await assert.rejects(WWAAPI.getRegionAlerts(region));
  await assert.rejects(WWAAPI.getAlerts(Infinity, 0));
  assert.equal(calls.length, 3);
  body = { features: [], exceededTransferLimit: true };
  await assert.rejects(WWAAPI.getAlerts(35,-97), /transfer limit/);
  body = { features: [], properties: { exceededTransferLimit: true } };
  await assert.rejects(WWAAPI.getAlerts(35,-97), /transfer limit/);
  body = { error: { message: 'Query failed' } };
  await assert.rejects(WWAAPI.getAlerts(35,-97), /Invalid WWA/);
  ok = false;
  await assert.rejects(WWAAPI.getAlerts(35,-97), /503/);
});

test('caller cancellation reaches NWS, WWA and every EdgeWARN alert request', async t => {
  let controller;
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push(url);
    assert.equal(options.signal.aborted, false);
    controller.abort();
    assert.equal(options.signal.aborted, true);
    throw options.signal.reason;
  });
  for (const run of [
    signal => NWSAPI.getRegionAlerts({ area: ['TX'] }, signal),
    signal => NWSAPI.getAlertById('abc', signal),
    signal => WWAAPI.getAlerts(35,-97,signal),
    signal => WWAAPI.getRegionAlerts({ wfo: ['KFWD'] }, signal),
  ]) {
    controller = new AbortController();
    await assert.rejects(run(controller.signal), { name: 'AbortError' });
  }
  const api = new EdgeWARNAPI({ baseUrl: 'https://example.test', routes: { alerts: '/alerts', alertSnapshots: '/snapshots' }, alertQuery: {}, pageSize: 10 }, { cache: () => new Map() });
  for (const run of [
    signal => api.fetchNWSTimestamps({ signal }),
    signal => api.fetchNWSAlertList('20261108-120000', { signal }),
    signal => api.downloadNWSAlert('abc', { signal }),
  ]) {
    controller = new AbortController();
    await assert.rejects(run(controller.signal), { name: 'AbortError' });
  }
  assert.equal(calls.length, 7);
});

test('EdgeWARN pagination keeps the signal on subsequent pages', async t => {
  const controller = new AbortController();
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls++;
    if (calls === 1) return response({ data: ['20261108-110000'], meta: { nextCursor: 'next' } });
    assert.match(url, /cursor=next/);
    controller.abort();
    assert.equal(options.signal.aborted, true);
    throw options.signal.reason;
  });
  const api = new EdgeWARNAPI({ baseUrl: 'https://example.test', routes: { alertSnapshots: '/snapshots' }, alertQuery: {}, pageSize: 1 }, { cache: () => new Map() });
  await assert.rejects(api.fetchNWSTimestamps({ signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls, 2);
});
