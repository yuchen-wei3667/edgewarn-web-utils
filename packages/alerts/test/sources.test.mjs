import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { NWSAPI, WWAAPI, setNwsUserAgent } from '@edgewarn/web-utils/net';
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

test('default point selection uses EdgeWARN and NWS; selected sources merge in fixed first-wins order', async t => {
  let wwa = 0, nws = 0;
  const fromEdge = feature('duplicate', { marker: 'edgewarn' });
  const fromNws = feature('https://api.weather.gov/alerts/duplicate', { marker: 'nws' });
  t.mock.method(NWSAPI, 'getAlerts', async () => { nws++; return { features: [fromNws, feature('nws')] }; });
  t.mock.method(WWAAPI, 'getAlerts', async () => { wwa++; return { features: [candidate('duplicate'), candidate('wwa')] }; });
  t.mock.method(NWSAPI, 'getAlertById', async id => feature(id, { marker: 'wwa' }));
  const api = edge([fromEdge]);
  const defaults = await loadLocationAlerts(point, { edgewarn: api });
  assert.equal(wwa,0);
  assert.equal(nws,1);
  assert.equal(defaults.find(f=>f.id==='duplicate').marker,'edgewarn');
  for (const source of [['wwa','nws','edgewarn'],['nws','edgewarn','wwa']]) {
    const result = await loadLocationAlerts(point, { edgewarn: api, source });
    assert.equal(result.length,3);
    assert.deepEqual(result.map(f=>f.id),['duplicate','nws','wwa']);
    assert.equal(result.find(f=>f.id==='duplicate').marker,'edgewarn');
    assert.deepEqual(result,sortDashboardAlerts(result));
  }
  for (const source of ['edgewarn','nws','wwa']) {
    const result = await loadLocationAlerts(point, { edgewarn: api, source });
    assert.ok(result.length);
  }
  const mixed = await loadLocationAlerts(point, { source: ['wwa','nws'] });
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

test('each source can fail alone, partial success survives, and all-selected failure throws', async t => {
  const fail = async () => { throw new Error('offline'); };
  t.mock.method(NWSAPI,'getAlerts',fail);
  t.mock.method(WWAAPI,'getAlerts',fail);
  const api = edge();
  assert.equal((await loadLocationAlerts(point,{edgewarn:api})).length,1);
  for (const source of ['nws','wwa']) await assert.rejects(loadLocationAlerts(point,{source}), /No alert source/);
  api.fetchNWSTimestamps = fail;
  for (const source of ['edgewarn',['edgewarn','nws','wwa']]) await assert.rejects(loadLocationAlerts(point,{edgewarn:api,source}), /No alert source/);
  NWSAPI.getAlerts = async () => ({ features: [feature('nws')] });
  assert.equal((await loadLocationAlerts(point,{edgewarn:api}))[0].id,'nws');
  NWSAPI.getAlerts = async () => ({ features: [] });
  assert.deepEqual(await loadLocationAlerts(point,{edgewarn:api}),[]);
});

test('EdgeWARN and WWA hydration are bounded to eight concurrent requests', async t => {
  const features = Array.from({length:19},(_,i)=>feature(String(i)));
  let active = 0, peak = 0;
  const hydrate = async id => { active++; peak = Math.max(peak,active); await delay(1); active--; return feature(id); };
  const api = edge(features);
  api.downloadNWSAlert = hydrate;
  assert.equal((await loadLocationAlerts(point,{edgewarn:api,source:'edgewarn'})).length,19);
  assert.equal(peak,8);
  peak = 0;
  t.mock.method(WWAAPI,'getAlerts',async()=>({features:features.map(f=>candidate(f.id))}));
  t.mock.method(NWSAPI,'getAlertById',hydrate);
  assert.equal((await loadLocationAlerts(point,{source:'wwa'})).length,19);
  assert.equal(peak,8);
  api.downloadNWSAlert = async () => null;
  assert.deepEqual(await loadLocationAlerts(point,{edgewarn:api,source:'edgewarn'}),sortDashboardAlerts(features));
});

test('WWA hydration fills absent geometry, drops failed alerts, and rejects total hydration failure', async t => {
  t.mock.method(WWAAPI,'getAlerts',async()=>({features:[candidate('good'),candidate('bad')]}));
  t.mock.method(NWSAPI,'getAlertById',async id=> { if(id==='bad')throw Error('missing'); return feature(id,{geometry:null}); });
  const result = await loadLocationAlerts(point,{source:'wwa'});
  assert.equal(result.length,1);
  assert.deepEqual(result[0].geometry,polygon);
  NWSAPI.getAlertById = async id => id === 'good' ? {} : feature(id);
  assert.deepEqual((await createWWAAlertSource().forPoint(point)).map(f=>f.id),['bad']);
  NWSAPI.getAlertById = async()=>{throw Error('missing');};
  await assert.rejects(createWWAAlertSource().forPoint(point),/All WWA alert hydration failed/);
  WWAAPI.getAlerts = async()=>({features:[]});
  assert.deepEqual(await loadLocationAlerts(point,{source:'wwa'}),[]);
});

test('region routing invokes only supporting sources and retains deterministic precedence', async t => {
  const calls=[];
  t.mock.method(NWSAPI,'getRegionAlerts',async region=>{calls.push(region);return {features:[feature('nws')]};});
  t.mock.method(WWAAPI,'getRegionAlerts',async region=>{calls.push(region);return {features:[candidate('duplicate'),candidate('wwa')]};});
  t.mock.method(NWSAPI,'getAlertById',async id=>feature(id,{marker:'wwa'}));
  const api=edge([feature('duplicate',{marker:'edgewarn'})]);
  for(const kind of ['area','region','zone']) {
    const region={[kind]:['TX']};
    assert.equal((await loadRegionAlerts(region,{edgewarn:api}))[0].id,'nws');
    assert.deepEqual(calls.at(-1),region);
  }
  assert.equal((await loadRegionAlerts({wfo:['KFWD']},{source:'wwa'})).length,2);
  const result=await loadRegionAlerts({bbox:[-99,31,-91,39]},{edgewarn:api,source:['wwa','nws','edgewarn']});
  assert.equal(result.length,2);
  assert.equal(result.find(f=>f.id==='duplicate').marker,'edgewarn');
  WWAAPI.getRegionAlerts = async()=>{throw Error('offline');};
  assert.equal((await loadRegionAlerts({bbox:[-99,31,-91,39]},{edgewarn:api,source:['edgewarn','wwa']})).length,1);
  await assert.rejects(loadRegionAlerts({wfo:['KFWD']},{source:'wwa'}), /No alert source/);
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

test('abort is not swallowed by source fallback or WWA hydration', async t => {
  const controller=new AbortController();
  const api=edge();
  api.downloadNWSAlert=async()=>{controller.abort();return null;};
  t.mock.method(NWSAPI,'getAlerts',async()=>({features:[]}));
  await assert.rejects(loadLocationAlerts(point,{edgewarn:api,signal:controller.signal}),{name:'AbortError'});
  const other=new AbortController();
  t.mock.method(WWAAPI,'getAlerts',async()=>({features:[candidate('a')]}));
  t.mock.method(NWSAPI,'getAlertById',async()=>{other.abort();throw other.signal.reason;});
  await assert.rejects(loadLocationAlerts(point,{source:'wwa',signal:other.signal}),{name:'AbortError'});
});

test('NWS source uses core headers and propagates caller signal to fetch', async t => {
  const controller=new AbortController();
  setNwsUserAgent('source-tests/1.0');
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.equal(options.headers['User-Agent'],'source-tests/1.0');
    controller.abort();
    assert.equal(options.signal.aborted,true);
    throw options.signal.reason;
  });
  try { await assert.rejects(loadLocationAlerts(point,{source:'nws',signal:controller.signal}),{name:'AbortError'}); }
  finally { setNwsUserAgent('edgewarn-core (https://github.com/yuchen-wei3667/edgewarn-web-utils)'); }
});
