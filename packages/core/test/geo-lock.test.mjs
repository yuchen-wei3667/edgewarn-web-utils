import test from 'node:test';
import assert from 'node:assert/strict';
import * as g from '@edgewarn/web-utils/geo';
const ring = [[10,20],[14,20],[14,24],[10,24],[10,20]];
const hole = [[11,21],[13,21],[13,23],[11,23],[11,21]];
const polygon = { type:'Polygon', coordinates:[ring,hole] };
test('containment retains coordinate order, outer boundaries, holes and degeneracies', () => {
 for (const [lat,lon,expected] of [[20.5,10.5,true],[22,12,false],[21,12,false],[20,12,true],[20,10,true],[10.5,20.5,false],[25,15,false]]) assert.equal(g.pointInGeometry(lat,lon,polygon),expected);
 assert.equal(g.pointInGeometry(22,12,{type:'MultiPolygon',coordinates:[[ring,hole],[hole]]}),true);
 assert.equal(g.pointInGeometry(0,0,{type:'MultiPolygon',coordinates:[[ring]]}),false);
 for (const coordinates of [[],[[]],[[[0,0]]]]) assert.equal(g.pointInGeometry(0,0,{type:'Polygon',coordinates}),false);
 assert.equal(g.pointInGeometry(0,0,{type:'Polygon',coordinates:[[[0,0],[1,1]]]}),true);
 assert.equal(g.pointInGeometry(20-1e-11,12,polygon),true);
});
test('math units and longitude endpoints', () => {
 assert.equal(g.toRad(180),Math.PI);
 assert.equal(g.distanceMiles(0,0,0,0),0);
 assert.ok(Math.abs(g.distanceMiles(0,0,0,1)-69.094)<0.01);
 assert.equal(g.calculateBearing(0,0,0,1),90);
 const [lat,lon]=g.calculateDestination(0,0,1000,90);
 assert.ok(Math.abs(lat)<1e-10); assert.ok(Math.abs(lon-0.008993216)<1e-8);
 for (const [a,b] of [[180,180],[-180,-180],[540,180],[-541,179]]) assert.equal(g.normalizeLongitude(a),b);
 assert.equal(g.clamp(5,0,4),4); assert.equal(g.clamp(-1,0,4),0);
});
test('polygon centroid, aliasing, hull, radius and projection', () => {
 assert.deepEqual(g.getPolygonCentroid([]),[0,0]);
 const single=[[1,2]]; assert.equal(g.getPolygonCentroid(single),single[0]); assert.equal(g.getConvexHull(single),single);
 assert.deepEqual(g.getPolygonCentroid([[0,0],[1,1],[2,2]]),[1,1]);
 const points=[[0,0],[0,2],[2,2],[2,0],[1,1]], original=structuredClone(points);
 assert.deepEqual(g.getPolygonCentroid(points.slice(0,4)),[1,1]);
 assert.equal(g.getConvexHull(points).length,4); assert.deepEqual(points,original);
 assert.equal(g.getPolygonApproxRadius(single),0); assert.ok(g.getPolygonApproxRadius(points.slice(0,4))>100000);
 const projected=g.projectAndScalePolygon(points.slice(0,4),30,40,2);
 assert.deepEqual(projected,[[28,38],[28,42],[32,42],[32,38]]);
 assert.equal(g.generatePolygonSegmentHulls([points,projected,points]).length,2);
 assert.deepEqual(g.generatePolygonSegmentHulls([single]),[]);
});
test('area winding and small labels',()=>{
 assert.equal(g.geometryAreaM2({type:'Polygon',coordinates:[ring]}),g.geometryAreaM2({type:'Polygon',coordinates:[[...ring].reverse()]}));
 assert.match(g.formatAlertCoverage({type:'Polygon',coordinates:[[[0,0],[.01,0],[.01,.01],[0,.01],[0,0]]]}),/^≈ 0\.5 sq mi$/);
});
