import assert from 'node:assert/strict';
import test from 'node:test';
import { geometryAreaM2, formatAlertCoverage } from '../src/geo/polygon-area.ts';

// 1°x1° square at the equator: ~12,364 km² (spherical earth).
const square = {
    type: 'Polygon',
    coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
};

test('geometryAreaM2 computes geodesic area for a Polygon', () => {
    const area = geometryAreaM2(square);
    assert.ok(area !== null);
    assert.ok(Math.abs(area - 12364000000) / 12364000000 < 0.01, `got ${area}`);
});

test('geometryAreaM2 subtracts holes and sums MultiPolygons', () => {
    const withHole = {
        type: 'Polygon',
        coordinates: [
            [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]],
            [[0.5, 0.5], [1.5, 0.5], [1.5, 1.5], [0.5, 1.5], [0.5, 0.5]],
        ],
    };
    const solid = geometryAreaM2({ type: 'Polygon', coordinates: [withHole.coordinates[0]] });
    const holed = geometryAreaM2(withHole);
    assert.ok(holed !== null && solid !== null && holed < solid);

    const multi = { type: 'MultiPolygon', coordinates: [square.coordinates, square.coordinates] };
    const single = geometryAreaM2(square);
    assert.equal(geometryAreaM2(multi), single * 2);
});

test('geometryAreaM2 returns null for missing or degenerate geometry', () => {
    assert.equal(geometryAreaM2(null), null);
    assert.equal(geometryAreaM2(undefined), null);
    assert.equal(geometryAreaM2({ type: 'Polygon', coordinates: [] }), null);
    assert.equal(geometryAreaM2({ type: 'Point', coordinates: [0, 0] }), null);
});

test('formatAlertCoverage renders a compact sq-mi label', () => {
    assert.equal(formatAlertCoverage(square), '≈ 4,774 sq mi');
    assert.equal(formatAlertCoverage(null), null);
});
