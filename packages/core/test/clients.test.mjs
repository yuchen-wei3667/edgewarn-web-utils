import test from 'node:test';
import assert from 'node:assert/strict';
import { EdgeWARNAPI, createNWSClient, createWWAClient, toNWSFeature, extractNWSAlertItems, normalizeStormcellFeatures } from '@edgewarn/web-utils/net';
import { createJsonRequester } from '../src/net/edgewarn/client.ts';
const config={baseUrl:'https://example.test/',routes:{stormSnapshots:'/frames',cells:'/tracks',alerts:'/warnings',alertSnapshots:'/warning-frames',health:'/ready'},alertQuery:{origin:'test'},pageSize:7};
const make=()=>new EdgeWARNAPI(config,{cache:()=>new Map()});
const json=(data,status=200)=>Response.json(data,{status});
const timestamp='20260102-030405';
test('EdgeWARN caller configuration owns every route, query and page size',async t=>{
 const calls=[];
 t.mock.method(globalThis,'fetch',async (url,init)=>{
 calls.push([url,init]);
 if(url.includes('/ready')) return json({ready:true});
 if(url.includes('/frames/'+timestamp)) return json({data:{cells:[]}});
 if(url.includes('/tracks/')) return json({data:{history:[{id:2}]}});
 if(url.includes('/warnings/')) return json({data:{id:'urn:test:2',name:'Tornado Warning'}});
 if(url.includes('/warning-frames/')) return json({data:{alerts:[{id:'urn:test:2',name:'Tornado Warning'}]}});
 return json({data:[timestamp]});
 });
 const api=make();
 assert.deepEqual(await api.fetchTimestamps(),[timestamp]);
 assert.deepEqual(await api.downloadStormcellList(timestamp),[]);
 assert.deepEqual(await api.downloadCellHistory(' 2 '),[{id:2}]);
 assert.deepEqual(await api.checkHealth(),{ready:true});
 assert.deepEqual(await api.fetchNWSTimestamps(),[timestamp]);
 assert.equal((await api.fetchNWSAlertList(timestamp))[0].id,'urn:test:2');
 assert.equal((await api.downloadNWSAlert('urn:test:2')).id,'urn:test:2');
 assert.deepEqual(calls.map(([url])=>url),[
 'https://example.test/frames?limit=7',
 'https://example.test/frames/'+timestamp,
 'https://example.test/tracks/2',
 'https://example.test/ready',
 'https://example.test/warning-frames?origin=test&limit=7',
 'https://example.test/warning-frames/'+timestamp+'?origin=test',
 'https://example.test/warnings/urn%3Atest%3A2?origin=test']);
 assert.ok(calls.every(([,init])=>init.cache==='no-store'));
 await assert.rejects(api.downloadStormcellList('bad'),/timestamp/i);
 await assert.rejects(api.downloadCellHistory(' '),/cell ID/);
});
test('collection cursor traversal rejects malformed envelopes and repeating cursors',async t=>{
 let n=0;
 t.mock.method(globalThis,'fetch',async url=>{
 n++; assert.equal(new URL(url).searchParams.get('cursor'),n===1?null:'next');
 return json({data:[n],meta:{nextCursor:n===1?'next':null}});
 });
 assert.deepEqual(await make().fetchTimestamps(),[1,2]);
 globalThis.fetch=async()=>json({data:[],meta:{nextCursor:'same'}});
 await assert.rejects(make().fetchTimestamps(),/repeating/);
 for(const payload of [{}, {data:{}}, {data:[],meta:{nextCursor:2}}]) {
 globalThis.fetch=async()=>json(payload); await assert.rejects(make().fetchTimestamps(),/Invalid/);
 }
 globalThis.fetch=async()=>json({}); await assert.rejects(make().downloadStormcellList(timestamp),/envelope/);
});
test('snapshot promise cache shares requests and evicts failed requests',async t=>{
 let calls=0, resolve;
 t.mock.method(globalThis,'fetch',()=>{calls++; return new Promise(r=>resolve=r);});
 const api=make(); const a=api.downloadStormcellList(timestamp),b=api.downloadStormcellList(timestamp);
 assert.equal(calls,1); resolve(json({data:{cells:[{id:1}]}}));
 assert.deepEqual(await a,await b); await api.downloadStormcellList(timestamp); assert.equal(calls,1);
 let failures=0; globalThis.fetch=async()=>{failures++; throw Error('offline');};
 const broken=make(); await assert.rejects(broken.downloadStormcellList(timestamp)); await assert.rejects(broken.downloadStormcellList(timestamp)); assert.equal(failures,2);
});
test('Q12 alert callbacks settle individually; Q13 hydration falls back by feature ID',async t=>{
 const feature={id:'canonical',name:'Tornado Warning'};
 t.mock.method(globalThis,'fetch',async()=>json({data:{alerts:[feature,{id:'second',name:'Flood Warning'}]}}));
 let callbacks=0;
 const api=make(); const result=await api.downloadNWS(timestamp,async()=>{callbacks++; throw Error('callback');});
 assert.equal(result.data.features.length,2); assert.equal(callbacks,2);
 globalThis.fetch=async()=>json({data:feature});
 assert.equal((await api.downloadNWSAlert('alias')).id,'canonical');
 globalThis.fetch=async()=>{throw Error('offline');};
 assert.equal((await api.downloadNWSAlert('canonical')).id,'canonical');
 assert.equal(await api.downloadNWSAlert('alias'),null);
 assert.equal(await api.downloadNWSAlert(' '),null);
});
test('downloadNWS retries four attempts with exponential backoff',async t=>{
 t.mock.timers.enable({apis:['setTimeout']}); let count=0;
 t.mock.method(globalThis,'fetch',async()=>{count++; throw Error('offline');});
 const result=assert.rejects(make().downloadNWS(timestamp),/offline/);
 for(const delay of [500,1000,2000]) { for(let n=0;n<20;n++) await Promise.resolve(); t.mock.timers.tick(delay); }
 await result; assert.equal(count,4);
});
test('request errors, content type and abort propagation stay at transport boundary',async t=>{
 const request=createJsonRequester('https://test');
 t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({detail:'unavailable'}),{status:503,headers:{'X-Request-Id':'abc'}}));
 await assert.rejects(request('/x'),/unavailable \(request abc\)/);
 globalThis.fetch=async()=>new Response('html'); await assert.rejects(request('/x'),/non-JSON/);
 globalThis.fetch=async()=>{throw new TypeError('Failed to fetch');}; await assert.rejects(request('/x'),/Failed to connect/);
 const c=new AbortController(); c.abort('reason');
 globalThis.fetch=async(_url,init)=>{assert.equal(init.signal.reason,'reason'); throw Error('aborted');};
 await assert.rejects(request('/x',undefined,{signal:c.signal}),/aborted/);
});
test('parsers preserve alert envelopes, coercion and stormcell shapes',()=>{
 assert.equal(toNWSFeature(null,''),null); assert.equal(toNWSFeature({},''),null);
 assert.equal(toNWSFeature({feature:{type:'Feature',properties:{id:'p'}}},'fallback').id,'p');
 assert.equal(toNWSFeature({id:'x',alert_type:'warning',severity:'warning'},'').properties.severity,'Severe');
 assert.deepEqual(extractNWSAlertItems({data:{ids:['a']}}),['a']); assert.deepEqual(extractNWSAlertItems({ids:[]}),[]);
 for(const payload of [[{id:1}],{features:{x:{id:1}}},{content:{features:[{id:1}]}},{cells:{features:[{id:1}]}},{cells:{x:{id:1}}}]) assert.deepEqual(normalizeStormcellFeatures(payload),[{id:1}]);
 assert.deepEqual(normalizeStormcellFeatures(null),[]);
});
test('NWS precision, per-client headers, passthroughs and status errors',async t=>{
 const calls=[];
 t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push([url,init]); return json({ok:true});});
 const nws = createNWSClient({ userAgent: 'test-agent' });
 await nws.getPoint(12.345678,-98.765432); await nws.getAlerts(12.345678,-98.765432);
 await nws.getLatestObservation('A/B');
 for(const method of ['getForecast','getHourlyForecast','getGridData','getStations']) await nws[method]('https://test/'+method);
 assert.equal(calls[0][0],'https://api.weather.gov/points/12.3457,-98.7654');
 assert.equal(calls[1][0],'https://api.weather.gov/alerts/active?point=12.3457,-98.7654');
 assert.equal(calls[2][0],'https://api.weather.gov/stations/A%2FB/observations/latest');
 assert.equal(calls[0][1].headers['User-Agent'],'test-agent');
 assert.equal(calls[0][1].headers.Accept,'application/geo+json');
 // User-Agent is sent unconditionally; browsers drop the forbidden header,
 // so a global window must not change request headers.
 globalThis.window={};
 try { await nws.getPoint(0,0); assert.equal(calls.at(-1)[1].headers['User-Agent'],'test-agent'); } finally { delete globalThis.window; }
 globalThis.fetch=async()=>new Response('',{status:404}); await assert.rejects(nws.getPoint(0,0),/NWS request failed \(404\)/);
});
test('two NWS clients keep their own User-Agent and base URL',async t=>{
 const calls=[];
 t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push([url,init]); return json({ok:true});});
 const a = createNWSClient({ userAgent: 'agent-a', baseUrl: 'https://mirror-a.example.gov/' });
 const b = createNWSClient({ userAgent: 'agent-b' });
 await a.getAlerts(35,-97); await b.getAlerts(35,-97);
 assert.equal(calls[0][0],'https://mirror-a.example.gov/alerts/active?point=35.0000,-97.0000');
 assert.equal(calls[0][1].headers['User-Agent'],'agent-a');
 assert.equal(calls[1][0],'https://api.weather.gov/alerts/active?point=35.0000,-97.0000');
 assert.equal(calls[1][1].headers['User-Agent'],'agent-b');
 // Class instances are per-consumer, not shared globals.
 assert.notEqual(a, b);
 assert.throws(() => createNWSClient({ baseUrl: 'http://insecure.example' }), /https/);
});
test('NWS and WWA clients can omit the User-Agent header',async t=>{
 const calls=[];
 t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push([url,init]); return json({features:[]});});
 await createNWSClient({userAgent:null}).getPoint(0,0);
 await createWWAClient({userAgent:null}).getAlerts(0,0);
 for(const [,init] of calls) {
  assert.equal(init.headers['User-Agent'],undefined);
  assert.equal(init.headers.Accept,'application/geo+json');
 }
});
