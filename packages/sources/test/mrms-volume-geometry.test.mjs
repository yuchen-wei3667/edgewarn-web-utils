import test from 'node:test';
import assert from 'node:assert/strict';
import { distanceMeters } from '@edgewarn/web-utils/geo';
import {
    CONUS_VOLUME_GRID, MRMS_VOLUME_LIMITS, boxSize, clampBox, clampLine, contains, neededRect, paddedRect, rectCols, rectRows,
} from '@edgewarn/web-utils/mrms';

const haversineM = (a, b) => distanceMeters(a.lat, a.lng, b.lat, b.lng);
const VOLUME_MAX_METERS = MRMS_VOLUME_LIMITS.maxLineMeters;
const VOLUME_MAX_BOX_METERS = MRMS_VOLUME_LIMITS.maxBoxMeters;

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b} (±${tol})`);

for (const lat of [25, 38, 49]) {
    test(`a long line stops at 96 mi at ${lat}N and keeps its bearing`, () => {
        const a = { lat, lng: -100 };
        const line = clampLine(a, { lat: lat + 3, lng: -97 });
        assert.equal(line.clamped, true);
        near(haversineM(line.a, line.b), VOLUME_MAX_METERS, 1);
        // same bearing: B lies on the segment's direction (north-east)
        assert.ok(line.b.lat > a.lat && line.b.lng > a.lng);
        const short = clampLine(a, { lat: lat + 0.1, lng: -100 });
        assert.equal(short.clamped, false);
        assert.deepEqual(short.b, { lat: lat + 0.1, lng: -100 });
    });

    test(`a large box keeps each side within 96 mi at ${lat}N`, () => {
        const box = clampBox({ lat, lng: -100 }, { lat: lat + 4, lng: -94 });
        assert.equal(box.clamped, true);
        assert.ok(box.heightM <= VOLUME_MAX_BOX_METERS + 1);
        assert.ok(box.widthM <= VOLUME_MAX_BOX_METERS + 1);
        near(box.heightM, VOLUME_MAX_BOX_METERS, 1);
        near(box.widthM, VOLUME_MAX_BOX_METERS, 20); // east-west is sized on a parallel, so it differs from the great circle by metres
        assert.ok(box.north > box.south && box.east > box.west);
    });
}

test('a box dragged toward the south-west is clamped on the correct sides', () => {
    const box = clampBox({ lat: 40, lng: -95 }, { lat: 38, lng: -98 });
    assert.equal(box.north, 40);
    assert.equal(box.east, -95);
    assert.ok(box.south < 40 && box.west < -95);
    assert.ok(box.widthM <= VOLUME_MAX_BOX_METERS + 1);
});

test('a small box is not clamped and reports its size', () => {
    const box = clampBox({ lat: 38, lng: -98 }, { lat: 38.1, lng: -97.9 });
    assert.equal(box.clamped, false);
    const size = boxSize(box);
    near(box.widthM, size.widthM, 0.001);
    assert.ok(box.heightM > 10_000 && box.heightM < 12_000);
});

test('needed rect covers the bounds plus a one-cell halo', () => {
    const g = CONUS_VOLUME_GRID;
    const r = neededRect({ west: -98.5, east: -98, south: 38, north: 38.5 }, g);
    // rows: (54.995 - 38.5)/0.01 = 1649.5 → 1649, (54.995-38)/0.01 = 1699.5 → 1700
    // cols: (-98.5 + 129.995)/0.01 = 3149.5 → 3149, (-98 + 129.995)/0.01 = 3199.5 → 3200
    assert.deepEqual(r, { r0: 1648, r1: 1701, c0: 3148, c1: 3201 });
});

test('padded rect adds a quarter of the span on each side and contains the needed rect', () => {
    const needed = neededRect({ west: -98.5, east: -98, south: 38, north: 38.5 });
    const padded = paddedRect(needed);
    assert.ok(contains(padded, needed));
    assert.equal(rectRows(padded), rectRows(needed) + 2 * Math.ceil(rectRows(needed) / 4));
    assert.equal(rectCols(padded), rectCols(needed) + 2 * Math.ceil(rectCols(needed) / 4));
    // a shape shifted by 16 mi stays inside the padded region
    const shifted = neededRect({ west: -98.4, east: -97.9, south: 38.1, north: 38.6 });
    assert.ok(contains(padded, shifted));
    const far = neededRect({ west: -95, east: -94.5, south: 38, north: 38.5 });
    assert.equal(contains(padded, far), false);
});

test('rects are clipped at the grid edges and null when fully outside', () => {
    const g = CONUS_VOLUME_GRID;
    const corner = neededRect({ west: -130.2, east: -129.9, south: 54.9, north: 55.3 }, g);
    assert.equal(corner.r0, 0);
    assert.equal(corner.c0, 0);
    const padded = paddedRect(corner, g);
    assert.equal(padded.r0, 0);
    assert.equal(padded.c0, 0);
    const south = neededRect({ west: -100, east: -99.5, south: 19.5, north: 20.1 }, g);
    assert.equal(south.r1, g.nj - 1);
    assert.equal(neededRect({ west: 10, east: 11, south: 10, north: 11 }, g), null);
});
