import test from 'node:test';
import assert from 'node:assert/strict';
import { linkedAbortSignal, fetchWithTimeout } from '../src/net/fetch-with-timeout.ts';
import { normalizeString, normalizeNullableString, normalizeNumber } from '../src/net/normalize.ts';
import { resolveAllowedFeedUrl } from '../src/net/allowed-hosts.ts';
test('normalizers retain coercion and fallback behavior',()=>{
 assert.equal(normalizeString(null,' x '),' x '); assert.equal(normalizeString(true),'true'); assert.equal(normalizeString(' a '),'a');
 assert.equal(normalizeNullableString(' '),null); assert.equal(normalizeNullableString(0),'0');
 for(const x of [null,undefined,true,false,{},'', ' ',NaN,Infinity,'Infinity']) assert.equal(normalizeNumber(x),null);
 for(const [x,v] of [[0,0],['0x10',16],[' 1e2 ',100]]) assert.equal(normalizeNumber(x),v);
});
test('feed URL policy retains credentials and ports and rejects suffix tricks',()=>{
 assert.equal(resolveAllowedFeedUrl('http://USER:pass@DATA.NOAA.GOV:8080/x?q=1#f'),'https://USER:pass@data.noaa.gov:8080/x?q=1#f');
 for(const host of ['noaa.gov','weather.gov','api.weather.gov']) assert.equal(resolveAllowedFeedUrl('https://'+host),'https://'+host+'/');
 for(const x of ['/x','bad','ftp://noaa.gov','https://evilnoaa.gov','https://noaa.gov.evil.test','https://noaa.gov@evil.test']) assert.equal(resolveAllowedFeedUrl(x),null);
});
test('linked signals preserve abort reasons and clean listeners/timers',t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const controller=new AbortController();
 const add=t.mock.method(controller.signal,'addEventListener'), remove=t.mock.method(controller.signal,'removeEventListener');
 const linked=linkedAbortSignal(controller.signal,20); controller.abort('caller'); assert.equal(linked.signal.reason,'caller');
 linked.dispose(); linked.dispose(); assert.equal(add.mock.callCount(),1); assert.equal(remove.mock.callCount(),2);
 const timed=linkedAbortSignal(undefined,20); t.mock.timers.tick(20); assert.equal(timed.signal.reason.name,'TimeoutError'); timed.dispose();
 for(const timeout of [0,-1]) { const x=linkedAbortSignal(undefined,timeout); t.mock.timers.tick(100000); assert.equal(x.signal.aborted,false); x.dispose(); }
 const already=linkedAbortSignal(controller.signal,0); assert.equal(already.signal.reason,'caller'); already.dispose();
});
test('fetch wrapper cleans up after headers, HTTP errors, rejection and sync throw',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 let signal;
 t.mock.method(globalThis,'fetch',(_url,init)=>{signal=init.signal; return Promise.resolve(new Response('bad',{status:500}));});
 assert.equal((await fetchWithTimeout('https://test')).status,500); t.mock.timers.tick(15000); assert.equal(signal.aborted,false);
 for(const fn of [()=>Promise.reject(new Error('failed')),()=>{throw new Error('failed');}]) {
 globalThis.fetch=(_url,init)=>{ signal=init.signal; return fn(); };
 await assert.rejects(fetchWithTimeout('https://test'),/failed/); t.mock.timers.tick(15000); assert.equal(signal.aborted,false);
 }
 globalThis.fetch=(_url,init)=>new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason)));
 const request=fetchWithTimeout('https://test',{timeoutMs:10}); const rejected=assert.rejects(request,{name:'TimeoutError'}); t.mock.timers.tick(10); await rejected;
});
