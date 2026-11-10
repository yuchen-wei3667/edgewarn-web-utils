import test from 'node:test';
import assert from 'node:assert/strict';
import { getDataset } from '../dist/datasets.js';
import { gridRectLngLatBounds, gridRotation, lambertForward, lambertInverse, lambertProjection } from '../dist/lambert.js';
import { projectionFor } from '../dist/projection/index.js';
import { buildIsobarSet } from '../dist/isobars.js';
import { combineInputs } from '../dist/recipes.js';
import { rotationTables } from '../dist/winds.js';
import { toHalf } from '@edgewarn/web-utils/grib2';

function seeded(seed) {
    let s = seed >>> 0;
    return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
}

// ── The Lambert adapter is the lambert.ts maths, unchanged ──

for (const id of ['hrrr', 'nbm']) {
    test(`${id}: the Lambert adapter equals the direct lambert.ts calls`, () => {
        const grid = getDataset(id).grid;
        const proj = projectionFor(grid);
        const direct = lambertProjection(grid);
        const rand = seeded(11);
        const cells = [[0, 0], [grid.nx - 1, 0], [0, grid.ny - 1], [grid.nx - 1, grid.ny - 1], [grid.nx / 2, grid.ny / 2]];
        for (let k = 0; k < 100; k++) cells.push([rand() * grid.nx, rand() * grid.ny]);
        for (const [i, j] of cells) {
            const [lat, lon] = lambertInverse(direct, i, j);
            assert.deepEqual(proj.inverse(i, j), [lat, lon]);
            assert.deepEqual(proj.forward(lat, lon), lambertForward(direct, lat, lon));
            assert.equal(proj.rotation(lat, lon), gridRotation(direct, lon));
        }
        assert.equal(proj.kind, 'lambert');
        assert.equal(proj.cellMetres(0), grid.dx);
        assert.equal(proj.cellMetres(50), grid.dx);
    });

    test(`${id}: a Lambert rectangle is one box, the walked bounds of lambert.ts`, () => {
        const grid = getDataset(id).grid;
        const boxes = projectionFor(grid).rectBounds(0, 0, grid.nx - 1, grid.ny - 1);
        assert.equal(boxes.length, 1);
        assert.deepEqual(boxes[0], gridRectLngLatBounds(lambertProjection(grid), 0, 0, grid.nx - 1, grid.ny - 1));
    });
}

test('Lambert uniforms are the constants the shader expects', () => {
    const grid = getDataset('hrrr').grid;
    const p = lambertProjection(grid);
    assert.deepEqual(projectionFor(grid).uniforms(), { kind: 0, a: [p.n, p.rF, p.lov * Math.PI / 180, 0], b: [p.x0, p.y0, p.dx, p.dy] });
});

test('projectionFor refuses a grid it has no projection for', () => {
    assert.throws(() => projectionFor({ projection: 'rotated-pole', nx: 1, ny: 1 }), /No projection for grid rotated-pole/);
});

// ── Regular lat/lon (GFS) ──

const gfs = getDataset('gfs').grid;
const ll = projectionFor(gfs);

test('lat/lon: a cell round-trips within 1e-9 cells, and row 0 is the north edge for scan 0x00', () => {
    const rand = seeded(5);
    for (let k = 0; k < 500; k++) {
        const i = rand() * gfs.nx - 0.5;
        const j = rand() * gfs.ny;
        const [lat, lon] = ll.inverse(i, j);
        const [i2, j2] = ll.forward(lat, lon);
        assert.ok(Math.abs(i2 - i) < 1e-9 && Math.abs(j2 - j) < 1e-9, `(${i}, ${j}) -> (${i2}, ${j2})`);
    }
    assert.deepEqual(ll.inverse(0, 0), [90, 0]);
    assert.deepEqual(ll.inverse(0, 720), [-90, 0]);
    assert.deepEqual(ll.inverse(720, 360), [0, -180], 'column 720 is 180 degrees, reported as -180');
});

test('lat/lon: scan 0x40 counts rows from the south', () => {
    const south = projectionFor({ ...gfs, scanMode: 0x40, lat1: -90 });
    assert.deepEqual(south.inverse(0, 0), [-90, 0]);
    assert.deepEqual(south.forward(-89.75, 0), [0, 1]);
});

test('lat/lon: longitude wraps across the seam of a global grid', () => {
    const at = (lon) => ll.forward(0, lon)[0];
    assert.ok(Math.abs(at(359.9) - 1439.6) < 1e-9 || Math.abs(at(359.9) - (-0.4)) < 1e-9);
    assert.ok(Math.abs(at(-0.1) - at(359.9)) < 1e-9, 'the same longitude, however it is written');
    assert.ok(Math.abs(at(-180) - 720) < 1e-9 && Math.abs(at(180) - 720) < 1e-9);
    // Every longitude lands in [-0.5, nx - 0.5): one cell per longitude, no gap and no overlap.
    for (let lon = -540; lon <= 540; lon += 0.3) {
        const i = ll.forward(0, lon)[0];
        assert.ok(i >= -0.5 - 1e-9 && i < gfs.nx - 0.5 + 1e-9, `${lon} -> ${i}`);
    }
});

test('lat/lon: a regional grid reads points west of its first column as small negative columns', () => {
    const regional = projectionFor({ projection: 'latlon', nx: 41, ny: 21, lat1: 50, lon1: 250, dlat: 0.25, dlon: 0.25, scanMode: 0x00, radiusM: 6371229 });
    assert.deepEqual(regional.forward(45, 250), [0, 20]);
    const [i] = regional.forward(45, 249);
    assert.ok(Math.abs(i - (-4)) < 1e-9);
    // Far outside the grid the column is out of range, never wrapped back into it.
    assert.ok(regional.forward(45, 100)[0] < -0.5 || regional.forward(45, 100)[0] > 40.5);
});

test('lat/lon: rotation is zero everywhere and a cell narrows toward the pole', () => {
    assert.equal(ll.rotation(40, -100), 0);
    assert.ok(Math.abs(ll.cellMetres(0) - 27799) < 5, `${ll.cellMetres(0)}`);
    assert.ok(Math.abs(ll.cellMetres(60) / ll.cellMetres(0) - 0.5) < 1e-9);
});

test('lat/lon: a rectangle that crosses 180 degrees splits into two boxes inside [-180, 180]', () => {
    // Columns 700..740 are 175 E to 185 E (-175).
    const boxes = ll.rectBounds(700, 100, 740, 200);
    assert.equal(boxes.length, 2);
    assert.deepEqual(boxes[0], [175, 40, 180, 65]);
    assert.deepEqual(boxes[1], [-180, 40, -175, 65]);
    for (const [w, , e] of boxes) assert.ok(w >= -180 && e <= 180);
    assert.deepEqual(ll.rectBounds(10, 100, 50, 200), [[2.5, 40, 12.5, 65]]);
    assert.deepEqual(ll.rectBounds(-0.5, -0.5, gfs.nx - 0.5, gfs.ny - 0.5), [[-180, -90, 180, 90]]);
});

/** `llForward` from LATLON_GLSL with every operation rounded to float32, as the GPU computes it. */
function shaderForward(p, lng, lat) {
    const f = Math.fround;
    const { a, b } = p.uniforms();
    const t = f(f(f(f(lng) - f(a[1])) - f(b[1])) + 180);
    const d = f(f(f(t - f(360 * Math.floor(f(t / 360)))) - 180) + f(b[1]));
    return [f(d / f(a[3])), f(f(f(f(lat) - f(a[0])) / f(a[2])) * f(b[0]))];
}

test('lat/lon: float32 shader arithmetic stays under 0.01 cell from the reference over the globe', () => {
    let worst = 0;
    for (let lat = -89.9; lat <= 89.9; lat += 1.7) {
        for (let lon = -180; lon < 180; lon += 1.3) {
            const [i, j] = ll.forward(lat, lon);
            const [si, sj] = shaderForward(ll, lon, lat);
            // A longitude within float32 of the seam may land one side or the other: both are the same cell to within half a cell.
            const di = Math.min(Math.abs(si - i), Math.abs(Math.abs(si - i) - gfs.nx));
            worst = Math.max(worst, Math.hypot(di, sj - j));
        }
    }
    assert.ok(worst < 0.01, `worst error ${worst} cells`);
});

// ── Everything that used a Lambert projection works through the interface ──

test('winds on a lat/lon grid need no rotation: a grid-relative vector is already east/north', () => {
    const level = (values) => ({ level: 0, factor: 1, nx: values.length, ny: 1, data: Uint16Array.from(values, toHalf) });
    const out = combineInputs('vector', [level([3, -2]), level([4, 5])], ll, { frame: 'grid' });
    assert.deepEqual(Array.from(out.data), [toHalf(3), toHalf(4), toHalf(-2), toHalf(5)]);
    const { cos, sin } = rotationTables(ll, 4, 3, 2);
    assert.ok(cos.every((c) => c === 1) && sin.every((s) => s === 0));
});

test('isobars on a global grid are cut where they cross the antimeridian', () => {
    // A ridge of low pressure straddling longitude 180 (column 720), as a closed feature around it.
    const nx = 40, ny = 24;
    const small = projectionFor({ projection: 'latlon', nx, ny, lat1: 60, lon1: 160, dlat: 1, dlon: 1.0, scanMode: 0x00, radiusM: 6371229 });
    const values = new Float32Array(nx * ny);
    for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) values[r * nx + c] = 1016 - 14 * Math.exp(-(((c - 20) / 5) ** 2 + ((r - 12) / 5) ** 2));
    const { lines } = buildIsobarSet({ nx, ny, factor: 1, values }, small);
    assert.ok(lines.length > 0);
    for (const line of lines) {
        for (let k = 1; k < line.coordinates.length; k++) {
            assert.ok(Math.abs(line.coordinates[k][0] - line.coordinates[k - 1][0]) <= 180, 'no segment runs the long way round the map');
        }
    }
    // The low sits on the antimeridian, so at least one contour was split in two pieces.
    const longitudes = lines.flatMap((l) => l.coordinates.map(([lon]) => lon));
    assert.ok(longitudes.some((lon) => lon > 170) && longitudes.some((lon) => lon < -170));
});
