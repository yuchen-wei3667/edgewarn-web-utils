import test from 'node:test';
import assert from 'node:assert/strict';
import {
    groundRangeAndBearing, slantRangeOf, beamHeightMeters, locateGate, radarQuad, mercatorUnit, mercatorY, shaderGeometryFloat32,
    EARTH_RADIUS_M, MERCATOR_RADIUS_M, buildAzimuthLut, NEXRAD_SITES,
} from '../dist/nexrad/index.js';

// Deterministic generator so failures reproduce.
let seed = 12345;
const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };

test('range and bearing: known points', () => {
    const site = { lat: 35.3331, lon: -97.2778 }; // KTLX
    const north = groundRangeAndBearing(site, site.lat + 1, site.lon);
    assert.ok(Math.abs(north.groundMeters - EARTH_RADIUS_M * Math.PI / 180) < 1);
    assert.ok(north.bearing < 1e-6 || north.bearing > 359.999999);
    const east = groundRangeAndBearing(site, site.lat, site.lon + 0.5);
    assert.ok(Math.abs(east.bearing - 90) < 0.2);
});

test('slant range is within a gate of ground range at low elevation and grows with elevation', () => {
    const s0 = slantRangeOf(100000, 0.5);
    assert.ok(Math.abs(s0 - 100000) < 700);
    assert.ok(slantRangeOf(100000, 8) > s0);
});

test('beam height matches the previous formula', () => {
    // 100 km at 0.5 deg: about 1.5 km above the radar
    const h = beamHeightMeters(100000, 0.5, 0);
    assert.ok(h > 1300 && h < 1600, String(h));
    assert.equal(beamHeightMeters(0, 0.5, 300), 300);
});

test('radar quad covers the range ring and is centred on the site', () => {
    const site = { lat: 35.33, lon: -97.28 };
    const quad = radarQuad(site, 460000);
    const [cx, cy] = mercatorUnit(site.lon, site.lat);
    const xs = [0, 4, 8, 12].map((i) => quad.vertices[i]);
    const ys = [1, 5, 9, 13].map((i) => quad.vertices[i]);
    assert.ok(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2 - cx) < 1e-6);
    assert.ok(Math.abs((Math.min(...ys) + Math.max(...ys)) / 2 - cy) < 1e-6);
    // local coords are mercator metres, at least the range
    assert.ok(quad.vertices[2] <= -460000 && quad.vertices[6] >= 460000);
    assert.equal(quad.indices.length, 6);
});

test('shader arithmetic (float32) stays within 0.25 gate and 0.1 degree of the float64 reference', () => {
    const sites = ['KTLX', 'KOKX', 'KATX', 'KBYX', 'KMKX', 'KFTG'].map((id) => NEXRAD_SITES.find((s) => s.id === id));
    let worstGate = 0;
    let worstAz = 0;
    let n = 0;
    for (const site of sites) {
        for (let i = 0; i < 1700; i++) {
            const ground = 2000 + rand() * 300000;
            const az = rand() * 360;
            // point at (ground, az) from the site, then its mercator-local offset, as the quad would give the shader
            const lat = Math.asin(Math.sin(site.lat * Math.PI / 180) * Math.cos(ground / EARTH_RADIUS_M) + Math.cos(site.lat * Math.PI / 180) * Math.sin(ground / EARTH_RADIUS_M) * Math.cos(az * Math.PI / 180)) * 180 / Math.PI;
            const lon = site.lon + Math.atan2(Math.sin(az * Math.PI / 180) * Math.sin(ground / EARTH_RADIUS_M) * Math.cos(site.lat * Math.PI / 180), Math.cos(ground / EARTH_RADIUS_M) - Math.sin(site.lat * Math.PI / 180) * Math.sin(lat * Math.PI / 180)) * 180 / Math.PI;
            const localX = (lon - site.lon) * Math.PI / 180 * MERCATOR_RADIUS_M;
            const localY = mercatorY(lat) - mercatorY(site.lat);
            const elev = 0.5 + rand() * 4;
            const ref = groundRangeAndBearing(site, lat, lon);
            const refSlant = slantRangeOf(ref.groundMeters, elev);
            const got = shaderGeometryFloat32(site, localX, localY, elev);
            worstGate = Math.max(worstGate, Math.abs(got.slantMeters - refSlant) / 250);
            let dAz = Math.abs(got.bearing - ref.bearing);
            if (dAz > 180) dAz = 360 - dAz;
            worstAz = Math.max(worstAz, dAz);
            n++;
        }
    }
    assert.equal(n, 10200);
    assert.ok(worstGate < 0.25, `worst gate error ${worstGate}`);
    assert.ok(worstAz < 0.1, `worst azimuth error ${worstAz}`);
});

test('locateGate picks the row for the bearing and rejects points beyond range or in unswept azimuth', () => {
    const azimuths = Array.from({ length: 360 }, (_, i) => i + 0.5);
    const field = { gates: 400, firstGateMeters: 2125, gateSpacingMeters: 250, elevation: 0.5, azimuthLut: buildAzimuthLut(azimuths, 360) };
    const site = { lat: 35, lon: -97 };
    // 50 km due east
    const lon = site.lon + 50000 / (EARTH_RADIUS_M * Math.cos(35 * Math.PI / 180)) * 180 / Math.PI;
    const hit = locateGate(field, site, site.lat, lon);
    assert.ok(hit);
    assert.ok(Math.abs(hit.row - 90) <= 1);
    assert.ok(Math.abs(hit.gate - (50000 - 2125) / 250) < 8);
    assert.equal(locateGate(field, site, site.lat, site.lon + 5), null);
    const half = { ...field, azimuthLut: buildAzimuthLut(azimuths.slice(0, 180), 180) };
    assert.ok(locateGate(half, site, site.lat + 0.3, site.lon + 0.05)); // bearing ~10 deg: swept
    assert.equal(locateGate(half, site, site.lat - 0.3, site.lon - 0.05), null); // bearing ~190 deg: not swept
});
