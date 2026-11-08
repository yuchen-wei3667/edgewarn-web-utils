import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAlertId, normalizeOfficialAlertId, getFeatureAlertCacheKey, normalizeAlertGeometry, mergeLocationAlerts } from '@edgewarn/web-utils/alerts';
test('ID normalizers and cache keys retain their different prefixes (Q2)', () => {
 for(const [id,official] of [['abc','abc'],[' abc ','abc'],['official:abc','abc'],['https://api.weather.gov/alerts/abc','abc']]) {
  assert.equal(normalizeAlertId(id),id.trim());
  assert.equal(normalizeOfficialAlertId(id),official);
  assert.equal(getFeatureAlertCacheKey({id,properties:{id:'fallback'}}),'official:'+id.trim());
 }
 assert.equal(getFeatureAlertCacheKey(null),'');
 assert.equal(getFeatureAlertCacheKey({id:'',properties:{id:'abc'}}),'official:abc');
 const old={id:'official:abc',properties:{}}; const update={id:'https://api.weather.gov/alerts/abc',properties:{}};
 assert.deepEqual(mergeLocationAlerts([old],[update]),[update]);
});
test('legacy coordinate swapping stays hemisphere dependent and closes rings (Q9)', () => {
 for(const [input,expected] of [[[[30,-100],[30,-90],[40,-90]],[[-100,30],[-90,30],[-90,40],[-100,30]]],[[[100,-30],[110,-30],[110,-40]],[[-30,100],[-30,110],[-40,110],[-30,100]]]]) {
  assert.deepEqual(normalizeAlertGeometry({geometry:null,Polygon:input}).coordinates,[[expected]]);
 }
 assert.equal(normalizeAlertGeometry({geometry:null,Polygon:[[1,2],['bad',4]]}),null);
 assert.equal(normalizeAlertGeometry({geometry:null,Polygon:'[[30,-100],[30,-90],[40,-90]]'}),null);
 const geometry={type:'Polygon',coordinates:[[[1,2],[3,4],[5,6],[1,2]]]};
 assert.deepEqual(normalizeAlertGeometry({geometry,Polygon:[[30,-100],[30,-90],[40,-90]]}),{type:'MultiPolygon',coordinates:[geometry.coordinates]});
});
