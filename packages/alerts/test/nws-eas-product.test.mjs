import assert from 'node:assert/strict';
import test from 'node:test';
import { checkNWSRawAlertForEAS } from '@edgewarn/web-utils/alerts/nws';

const alertId = 'urn:oid:2.49.0.1.840.0.example.001.1';
const sent = '2026-09-13T14:00:00Z';
const vtec = '/O.NEW.KOKX.FF.W.0001.260913T1400Z-260913T1500Z/';

function nwsFetch(products) {
  return async (url, options) => {
    if (url.includes('/alerts/')) {
      assert.equal(options.headers.Accept, 'application/geo+json');
      return Response.json({ properties: {
        sent,
        description: 'Flash flooding is occurring in the warned area.',
        parameters: { AWIPSidentifier: ['FFWOKX'], VTEC: [vtec] },
      } });
    }
    if (url.endsWith('/products/types/FFW/locations/OKX')) {
      assert.equal(options.headers.Accept, 'application/ld+json');
      return Response.json({ '@graph': products.map(({ id }) => ({ '@id': `https://api.weather.gov/products/${id}`, issuanceTime: sent })) });
    }
    const id = url.split('/').at(-1);
    return Response.json({ productText: products.find(product => product.id === id).text });
  };
}

test('EAS check scans only the raw weather.gov product matched to the alert', async () => {
  const unrelated = { id: 'unrelated', text: `BULLETIN - EAS ACTIVATION REQUESTED\n/O.NEW.KOKX.FF.W.9999.260913T1400Z-260913T1500Z/` };
  const matching = { id: 'matching', text: `FFWOKX\n${vtec}\nBULLETIN - EAS ACTIVATION REQUESTED` };

  assert.deepEqual(await checkNWSRawAlertForEAS(alertId, nwsFetch([unrelated, matching])), { matched: true, easRequested: true, currentIssuanceRequestsEAS: true });
  assert.deepEqual(await checkNWSRawAlertForEAS(alertId, nwsFetch([unrelated])), { matched: false, easRequested: false, currentIssuanceRequestsEAS: false });
  assert.deepEqual(await checkNWSRawAlertForEAS(alertId, nwsFetch([{ ...matching, text: `FFWOKX\n${vtec}\nFlash flooding is occurring.` }])), { matched: true, easRequested: false, currentIssuanceRequestsEAS: false });
});

test('BLOCKCHANNEL=EAS does not turn an immediate-broadcast warning into an EAS request', async () => {
  const warningVtec = '/O.NEW.KUNR.SV.W.0358.260924T0015Z-260924T0115Z/';
  const warningSent = '2026-09-24T00:15:00Z';
  const rawText = `WUUS53 KUNR 240015\nSVRUNR\n${warningVtec}\nBULLETIN - IMMEDIATE BROADCAST REQUESTED\nSevere Thunderstorm Warning`;
  const fetcher = async (url) => {
    if (url.includes('/alerts/')) return Response.json({ properties: {
      sent: warningSent,
      messageType: 'Alert',
      parameters: { AWIPSidentifier: ['SVRUNR'], VTEC: [warningVtec], BLOCKCHANNEL: ['EAS', 'NWEM', 'CMAS'] },
    } });
    if (url.endsWith('/products/types/SVR/locations/UNR')) return Response.json({ '@graph': [
      { '@id': 'https://api.weather.gov/products/warning', issuanceTime: warningSent },
    ] });
    assert.equal(url, 'https://api.weather.gov/products/warning');
    return Response.json({ productText: rawText });
  };

  assert.deepEqual(await checkNWSRawAlertForEAS(alertId, fetcher), {
    matched: true, easRequested: false, currentIssuanceRequestsEAS: false,
  });
});

test('an update retains the original EAS status without requesting another tone', async () => {
  const originalVtec = '/O.NEW.KOKX.FF.W.0001.260913T1400Z-260913T1500Z/';
  const updateVtec = '/O.CON.KOKX.FF.W.0001.260913T1400Z-260913T1530Z/';
  const updateSent = '2026-09-13T14:30:00Z';
  const products = {
    update: `FFWOKX\n${updateVtec}\nBULLETIN - IMMEDIATE BROADCAST REQUESTED`,
    original: `FFWOKX\n${originalVtec}\nBULLETIN - EAS ACTIVATION REQUESTED`,
  };
  const fetcher = async (url) => {
    if (url.includes('/alerts/')) return Response.json({ properties: {
      sent: updateSent,
      messageType: 'Update',
      parameters: { AWIPSidentifier: ['FFWOKX'], VTEC: [updateVtec], BLOCKCHANNEL: ['EAS'] },
    } });
    if (url.endsWith('/products/types/FFW/locations/OKX')) return Response.json({ '@graph': [
      { '@id': 'https://api.weather.gov/products/update', issuanceTime: updateSent },
      { '@id': 'https://api.weather.gov/products/original', issuanceTime: sent },
    ] });
    const id = url.split('/').at(-1);
    assert.ok(id in products);
    return Response.json({ productText: products[id] });
  };

  assert.deepEqual(await checkNWSRawAlertForEAS(alertId, fetcher), {
    matched: true, easRequested: true, currentIssuanceRequestsEAS: false,
  });
});

test('cancellations never request playback and identifiers are URL encoded', async () => {
 let count=0;
 const result=await checkNWSRawAlertForEAS('a/b ?',async(url,options)=>{
  count++;
  assert.equal(url,'https://api.weather.gov/alerts/a%2Fb%20%3F');
  assert.equal(options.next,undefined);
  assert.equal(options.headers['User-Agent'],'consumer/1.0');
  return Response.json({properties:{messageType:' Cancel '}});
 },{userAgent:'consumer/1.0'});
 assert.equal(count,1);
 assert.deepEqual(result,{matched:false,easRequested:false,currentIssuanceRequestsEAS:false});
});

test('User-Agent reaches product listing and detail requests; failures propagate',async()=>{
 let count=0;
 const inner=nwsFetch([{id:'matching',text:`${vtec}\nBULLETIN - EAS ACTIVATION REQUESTED`}]);
 await checkNWSRawAlertForEAS(alertId,async(url,options)=>{
  count++;
  assert.equal(options.headers['User-Agent'],'consumer/1.0');
  assert.equal(options.next,undefined);
  assert.ok(options.signal instanceof AbortSignal);
  return inner(url,options);
 },{userAgent:'consumer/1.0'});
 assert.equal(count,3);
 await assert.rejects(checkNWSRawAlertForEAS(alertId,async()=>new Response('',{status:503})),/NWS API returned 503/);
});

test('untrusted product URLs are skipped and default identity is neutral',async()=>{
 let count=0;
 const result=await checkNWSRawAlertForEAS(alertId,async(url,options)=>{
  count++;
  assert.equal(options.headers['User-Agent'],'edgewarn-web-utils (https://github.com/yuchen-wei3667/edgewarn-web-utils)');
  if(url.includes('/alerts/'))return Response.json({properties:{sent,parameters:{AWIPSidentifier:['FFWOKX'],VTEC:[vtec]}}});
  assert.ok(url.startsWith('https://api.weather.gov/'));
  return Response.json({'@graph':[{'@id':'https://attacker.test/products/x',issuanceTime:sent}]});
 });
 assert.equal(count,2);
 assert.deepEqual(result,{matched:false,easRequested:false,currentIssuanceRequestsEAS:false});
});
