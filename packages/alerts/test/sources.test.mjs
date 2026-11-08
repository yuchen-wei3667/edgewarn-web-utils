import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { createNWSClient, createWWAClient } from '@edgewarn/web-utils/net';
import { loadLocationAlerts, loadRegionAlerts, createEdgeWARNAlertSource, createNWSAlertSource, createWWAAlertSource } from '@edgewarn/web-utils/alerts/nws';
import { sortDashboardAlerts } from '@edgewarn/web-utils/alerts';

const template = JSON.parse(readFileSync(new URL('fixtures/alerts.json', import.meta.url))).alerts[0];
const polygon = { type: 'Polygon', coordinates: [[[-100,30],[-90,30],[-90,40],[-100,40],[-100,30]]] };
const feature = (id, overrides = {}) => ({ ...structuredClone(template), id, geometry: polygon, ...overrides });
const point = { lat: 35, lon: -95 };
function edge(features = [feature('duplicate')]) {
  return {
    fetchNWSTimestamps: async () => ['20261108-120000','20261108-110000'],
    fetchNWSAlertList: async timestamp => { assert.equal(timestamp,'20261108-120000'); return features; },
    downloadNWSAlert: async id => features.find(f => f.id === id) ?? null,
  };
}
const candidate = id => ({ type: 'Feature', geometry: polygon, properties: { cap_id: id } });
// Per-test stub clients: each mock is an instance, never shared global state.
const nwsClient = (methods = {}) => Object.assign(createNWSClient({ userAgent: 'source-tests/1.0' }), methods);
const wwaClient = (methods = {}) => Object.assign(createWWAClient(), methods);

test('default point selection uses EdgeWARN and NWS; selected sources merge in fixed first-wins order', async () => {
  let wwa = 0, nws = 0;
  const fromEdge = feature('duplicate', { marker: 'edgewarn' });
  const fromNws = feature('https://api.weather.gov/alerts/duplicate', { marker: 'nws' });
  const fakes = {
    nws: nwsClient({
      getAlerts: async () => { nws++; return { features: [fromNws, feature('nws')] }; },
      getAlertById: async id => feature(id, { marker: 'wwa' }),
    }),
    wwa: wwaClient({ getAlerts: async () => { wwa++; return { features: [candidate('duplicate'), candidate('wwa')] }; } }),
  };
  const api = edge([fromEdge]);
  const defaults = await loadLocationAlerts(point, { edgewarn: api, ...fakes });
  assert.equal(wwa,0);
  assert.equal(nws,1);
  assert.equal(defaults.find(f=>f.id==='duplicate').marker,'edgewarn');
  for (const source of [['wwa','nws','edgewarn'],['nws','edgewarn','wwa']]) {
    const result = await loadLocationAlerts(point, { edgewarn: api, source, ...fakes });
    assert.equal(result.length,3);
    assert.deepEqual(result.map(f=>f.id),['duplicate','nws','wwa']);
    assert.equal(result.find(f=>f.id==='duplicate').marker,'edgewarn');
    assert.deepEqual(result,sortDashboardAlerts(result));
  }
  for (const source of ['edgewarn','nws','wwa']) {
    const result = await loadLocationAlerts(point, { edgewarn: api, source, ...fakes });
    assert.ok(result.length);
  }
  const mixed = await loadLocationAlerts(point, { source: ['wwa','nws'], ...fakes });
  assert.equal(mixed.find(f=>f.marker==='nws').id,fromNws.id);
});

test('selection errors and unsupported regions reject before requests', async t => {
  const forbidden = () => { throw new Error('unexpected request'); };
  const fetch = t.mock.method(globalThis,'fetch',forbidden);
  let requests = 0;
  const api = edge();
  api.fetchNWSTimestamps = async () => { requests++; return []; };
  for (const options of [{ source: [] }, { source: 'unknown' }, { source: ['nws','unknown'] }, { source: 'edgewarn' }, {}]) await assert.rejects(loadLocationAlerts(point,options));
  for (const source of [createNWSAlertSource(),createEdgeWARNAlertSource(api),createWWAAlertSource()]) {
    for (const [kind,value] of Object.entries({ area:['TX'], region:['GM'], zone:['TXZ001'], wfo:['KFWD'], bbox:[-100,30,-90,40] })) {
      if (!source.supportsRegion(kind)) await assert.rejects(source.forRegion({[kind]:value}), /unsupported region type/);
    }
  }
  await assert.rejects(loadRegionAlerts({ bbox: [-100,30,-90,40] }, {source:'nws'}), /No selected source supports/);
  await assert.rejects(loadRegionAlerts({ area: [] }, {source:'nws'}));
  await assert.rejects(loadRegionAlerts({ area:['TX'], zone:['TXZ001'] }, {source:'nws'}));
  await assert.rejects(loadLocationAlerts({ lat: 100, lon: 0 }, {source:'nws'}));
  assert.equal(fetch.mock.callCount(),0);
  assert.equal(requests,0);
});

test('each source can fail alone, partial success survives, and all-selected failure throws', async () => {
  const fail = async () => { throw new Error('offline'); };
  const fakes = { nws: nwsClient({ getAlerts: fail }), wwa: wwaClient({ getAlerts: fail }) };
  const api = edge();
  assert.equal((await loadLocationAlerts(point,{edgewarn:api, ...fakes})).length,1);
  for (const source of ['nws','wwa']) await assert.rejects(loadLocationAlerts(point,{source, ...fakes}), /No alert source/);
  api.fetchNWSTimestamps = fail;
  for (const source of ['edgewarn',['edgewarn','nws','wwa']]) await assert.rejects(loadLocationAlerts(point,{edgewarn:api,source, ...fakes}), /No alert source/);
  fakes.nws.getAlerts = async () => ({ features: [feature('nws')] });
  assert.equal((await loadLocationAlerts(point,{edgewarn:api, ...fakes}))[0].id,'nws');
  fakes.nws.getAlerts = async () => ({ features: [] });
  assert.deepEqual(await loadLocationAlerts(point,{edgewarn:api, ...fakes}),[]);
});

test('EdgeWARN and WWA hydration are bounded to eight concurrent requests', async () => {
  const features = Array.from({length:19},(_,i)=>feature(String(i)));
  let active = 0, peak = 0;
  const hydrate = async id => { active++; peak = Math.max(peak,active); await delay(1); active--; return feature(id); };
  const api = edge(features);
  api.downloadNWSAlert = hydrate;
  assert.equal((await loadLocationAlerts(point,{edgewarn:api,source:'edgewarn'})).length,19);
  assert.equal(peak,8);
  peak = 0;
  const fakes = {
    wwa: wwaClient({ getAlerts: async()=>({features:features.map(f=>candidate(f.id))}) }),
    nws: nwsClient({ getAlertById: hydrate }),
  };
  assert.equal((await loadLocationAlerts(point,{source:'wwa', ...fakes})).length,19);
  assert.equal(peak,8);
  api.downloadNWSAlert = async () => null;
  assert.deepEqual(await loadLocationAlerts(point,{edgewarn:api,source:'edgewarn'}),sortDashboardAlerts(features));
});

test('WWA hydration fills absent geometry, drops failed alerts, and rejects total hydration failure', async () => {
  const fakes = {
    wwa: wwaClient({ getAlerts: async()=>({features:[candidate('good'),candidate('bad')]}) }),
    nws: nwsClient({ getAlertById: async id=> { if(id==='bad')throw Error('missing'); return feature(id,{geometry:null}); } }),
  };
  const result = await loadLocationAlerts(point,{source:'wwa', ...fakes});
  assert.equal(result.length,1);
  assert.deepEqual(result[0].geometry,polygon);
  fakes.nws.getAlertById = async id => id === 'good' ? {} : feature(id);
  assert.deepEqual((await createWWAAlertSource(fakes.wwa, fakes.nws).forPoint(point)).map(f=>f.id),['bad']);
  fakes.nws.getAlertById = async()=>{throw Error('missing');};
  await assert.rejects(createWWAAlertSource(fakes.wwa, fakes.nws).forPoint(point),/All WWA alert hydration failed/);
  fakes.wwa.getAlerts = async()=>({features:[]});
  assert.deepEqual(await loadLocationAlerts(point,{source:'wwa', ...fakes}),[]);
});

test('region routing invokes only supporting sources and retains deterministic precedence', async () => {
  const calls=[];
  const fakes = {
    nws: nwsClient({
      getRegionAlerts: async region=>{calls.push(region);return {features:[feature('nws')]};},
      getAlertById: async id=>feature(id,{marker:'wwa'}),
    }),
    wwa: wwaClient({ getRegionAlerts: async region=>{calls.push(region);return {features:[candidate('duplicate'),candidate('wwa')]};} }),
  };
  const api=edge([feature('duplicate',{marker:'edgewarn'})]);
  for(const kind of ['area','region','zone']) {
    const region={[kind]:['TX']};
    assert.equal((await loadRegionAlerts(region,{edgewarn:api, ...fakes}))[0].id,'nws');
    assert.deepEqual(calls.at(-1),region);
  }
  assert.equal((await loadRegionAlerts({wfo:['KFWD']},{source:'wwa', ...fakes})).length,2);
  const result=await loadRegionAlerts({bbox:[-99,31,-91,39]},{edgewarn:api,source:['wwa','nws','edgewarn'], ...fakes});
  assert.equal(result.length,2);
  assert.equal(result.find(f=>f.id==='duplicate').marker,'edgewarn');
  fakes.wwa.getRegionAlerts = async()=>{throw Error('offline');};
  assert.equal((await loadRegionAlerts({bbox:[-99,31,-91,39]},{edgewarn:api,source:['edgewarn','wwa'], ...fakes})).length,1);
  await assert.rejects(loadRegionAlerts({wfo:['KFWD']},{source:'wwa', ...fakes}), /No alert source/);
});

test('EdgeWARN bbox uses actual geometry intersection, including holes and crossing edges, without hydration', async () => {
  const shapes = [
    feature('enclosing'),
    feature('crossing',{geometry:{type:'Polygon',coordinates:[[[-110,34],[-80,34],[-80,36],[-110,36],[-110,34]]]}}),
    feature('outside',{geometry:{type:'Polygon',coordinates:[[[0,0],[1,0],[1,1],[0,1],[0,0]]]}}),
    feature('hole',{geometry:{type:'Polygon',coordinates:[polygon.coordinates[0],[[-99,31],[-91,31],[-91,39],[-99,39],[-99,31]]]}}),
    feature('no-geometry',{geometry:null}),
    feature('touching',{geometry:{type:'Polygon',coordinates:[[[-94,35],[-93,35],[-93,36],[-94,36],[-94,35]]]}}),
  ];
  const api=edge(shapes);
  api.downloadNWSAlert=async()=>{throw Error('bbox must not hydrate');};
  const ids=(await loadRegionAlerts({bbox:[-96,34,-94,36]},{source:'edgewarn',edgewarn:api})).map(f=>f.id).sort();
  assert.deepEqual(ids,['crossing','enclosing','touching']);
});

test('abort is not swallowed by source fallback or WWA hydration', async () => {
  const controller=new AbortController();
  const api=edge();
  api.downloadNWSAlert=async()=>{controller.abort();return null;};
  const fakes = { nws: nwsClient({ getAlerts: async()=>({features:[]}) }) };
  await assert.rejects(loadLocationAlerts(point,{edgewarn:api,signal:controller.signal, ...fakes}),{name:'AbortError'});
  const other=new AbortController();
  const abortFakes = {
    wwa: wwaClient({ getAlerts: async()=>({features:[candidate('a')]}) }),
    nws: nwsClient({ getAlertById: async()=>{other.abort();throw other.signal.reason;} }),
  };
  await assert.rejects(loadLocationAlerts(point,{source:'wwa',signal:other.signal, ...abortFakes}),{name:'AbortError'});
});

test('NWS source uses per-client headers and propagates caller signal to fetch', async t => {
  const controller=new AbortController();
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.equal(options.headers['User-Agent'],'source-tests/1.0');
    controller.abort();
    assert.equal(options.signal.aborted,true);
    throw options.signal.reason;
  });
  await assert.rejects(loadLocationAlerts(point,{
    source:'nws', signal:controller.signal,
    nws: createNWSClient({ userAgent: 'source-tests/1.0' }),
  }),{name:'AbortError'});
});
