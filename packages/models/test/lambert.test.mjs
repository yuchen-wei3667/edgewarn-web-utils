import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeGrib2ToLevels, fromHalf, readGrib2Grid } from '@edgewarn/web-utils/grib2';
import { gridRectLngLatBounds, gridRotation, lambertForward, lambertInverse, lambertProjection } from '../dist/lambert.js';
import { rotateToEarth, rotationTables, speedAndDirection } from '../dist/winds.js';
import { projectionFor } from '../dist/projection/index.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'decoders', 'test', 'fixtures', 'models');
const reference = JSON.parse(readFileSync(path.join(DIR, 'reference.json'), 'utf8'));
const msg = (name) => new Uint8Array(readFileSync(path.join(DIR, name)));
const grid = readGrib2Grid(msg('t12z-f00-tmp2m.grib2'));
const proj = lambertProjection(grid);
const lonDiff = (a, b) => ((a - b + 540) % 360) - 180;

test('the cone constant for a tangent cone is sin(latin)', () => {
    assert.ok(Math.abs(proj.n - Math.sin(38.5 * Math.PI / 180)) < 1e-12);
});

test('every reference point lands on its grid cell (forward) and its lat/lon (inverse)', () => {
    for (const s of reference['t12z-f00-tmp2m.grib2'].samples) {
        const [i, j] = lambertForward(proj, s.lat, s.lon);
        assert.ok(Math.abs(i - s.i) < 0.01 && Math.abs(j - s.j) < 0.01, `forward (${s.i},${s.j}) -> (${i},${j})`);
        const [lat, lon] = lambertInverse(proj, s.i, s.j);
        assert.ok(Math.abs(lat - s.lat) < 1e-4 && Math.abs(lonDiff(lon, s.lon)) < 1e-4, `inverse (${s.i},${s.j})`);
    }
});

test('round trip error is under 0.01 cell at the corners and centre', () => {
    for (const [i, j] of [[0, 0], [grid.nx - 1, 0], [0, grid.ny - 1], [grid.nx - 1, grid.ny - 1], [899.5, 529.5]]) {
        const [lat, lon] = lambertInverse(proj, i, j);
        const [i2, j2] = lambertForward(proj, lat, lon);
        assert.ok(Math.hypot(i2 - i, j2 - j) < 0.01);
    }
});

test('grid corner (0,0) is the first grid point of the message', () => {
    const [lat, lon] = lambertInverse(proj, 0, 0);
    assert.ok(Math.abs(lat - grid.lat1) < 1e-6);
    assert.ok(Math.abs(lonDiff(lon, grid.lon1)) < 1e-6);
});

test('grid rotation matches the +i axis bearing measured from ecCodes lat/lon', () => {
    const samples = reference['t12z-f00-ugrd10m.grib2'].samples.filter((s) => s.gridXBearing !== undefined);
    assert.ok(samples.length > 10);
    for (const s of samples) {
        const want = s.gridXBearing;
        const got = 90 + gridRotation(proj, s.lon) * 180 / Math.PI;
        assert.ok(Math.abs(lonDiff(got, want)) < 0.05, `(${s.i},${s.j}): ${got} vs ${want}`);
    }
});

test('rotation preserves speed and turns a grid-east wind to the grid bearing', () => {
    const { cos, sin } = rotationTables(projectionFor(grid), 2, 1, 900);
    const u = new Float32Array([10, 10]);
    const v = new Float32Array([0, 0]);
    rotateToEarth(u, v, cos, sin);
    for (let k = 0; k < 2; k++) {
        assert.ok(Math.abs(Math.hypot(u[k], v[k]) - 10) < 1e-4);
        const [, lon] = lambertInverse(proj, k * 900 + 449.5, 449.5 / 900 * 0 + 449.5);
        const bearing = Math.atan2(u[k], v[k]) * 180 / Math.PI;
        assert.ok(Math.abs(lonDiff(bearing, 90 + gridRotation(proj, lon) * 180 / Math.PI)) < 0.01);
    }
});

test('rotated 10 m winds keep the decoded speed field', () => {
    const { levels: [u2] } = decodeGrib2ToLevels(msg('t12z-f00-ugrd10m.grib2'), { factors: [1, 2, 3], levels: [2] });
    const { levels: [v2] } = decodeGrib2ToLevels(msg('t12z-f00-vgrd10m.grib2'), { factors: [1, 2, 3], levels: [2] });
    const u = Float32Array.from(u2.data, fromHalf);
    const v = Float32Array.from(v2.data, fromHalf);
    const before = u.map((x, k) => Math.hypot(x, v[k]));
    const { cos, sin } = rotationTables(projectionFor(grid), u2.nx, u2.ny, 3);
    rotateToEarth(u, v, cos, sin);
    for (let k = 0; k < u.length; k += 997) assert.ok(Math.abs(Math.hypot(u[k], v[k]) - before[k]) < 1e-3);
});

test('speed and direction use the meteorological convention', () => {
    assert.deepEqual(speedAndDirection(0, -5), { speed: 5, direction: 0 });    // from the north
    assert.equal(Math.round(speedAndDirection(-5, 0).direction), 90);         // from the east
    assert.equal(Math.round(speedAndDirection(5, 5).direction), 225);         // from the south-west
});

test('rectangle bounds contain the grid corners they span', () => {
    const [w, s, e, n] = gridRectLngLatBounds(proj, 0, 0, grid.nx - 1, grid.ny - 1);
    for (const sample of reference['t12z-f00-tmp2m.grib2'].samples) {
        const lon = lonDiff(sample.lon, 0);
        assert.ok(lon >= w - 1e-6 && lon <= e + 1e-6 && sample.lat >= s - 1e-6 && sample.lat <= n + 1e-6);
    }
    assert.ok(n > 52 && s < 22 && w < -134 && e > -61);
});

// ── A second Lambert grid: NBM (2345 x 1597, 2.54 km, tangent cone at 25 degrees, 6 371 200 m sphere) ──

const nbmGrid = readGrib2Grid(new Uint8Array(readFileSync(path.join(DIR, 'nbm', 't12z-f012-vis.grib2'))));
const nbmProj = lambertProjection(nbmGrid);

test('the projection takes the earth radius from the grid and refuses to guess', () => {
    assert.equal(grid.radiusM, 6371229);
    assert.equal(nbmGrid.radiusM, 6371200);
    // A 29 m smaller sphere moves rF by the same ratio; nothing is hardcoded to HRRR's.
    assert.ok(Math.abs(nbmProj.rF / lambertProjection({ ...nbmGrid, radiusM: 6371229 }).rF - 6371200 / 6371229) < 1e-12);
    assert.throws(() => lambertProjection({ ...grid, radiusM: undefined }), /needs the earth radius/);
    assert.equal(lambertProjection({ ...grid, radiusM: undefined }, 6371229).rF, proj.rF);
});

test('NBM forward and inverse projections round-trip within 0.01 cell at the corners and centre', () => {
    assert.ok(Math.abs(nbmProj.n - Math.sin(25 * Math.PI / 180)) < 1e-12);
    for (const [i, j] of [[0, 0], [nbmGrid.nx - 1, 0], [0, nbmGrid.ny - 1], [nbmGrid.nx - 1, nbmGrid.ny - 1], [nbmGrid.nx / 2, nbmGrid.ny / 2]]) {
        const [lat, lon] = lambertInverse(nbmProj, i, j);
        const [ri, rj] = lambertForward(nbmProj, lat, lon);
        assert.ok(Math.hypot(ri - i, rj - j) < 0.01, `(${i},${j}) -> ${ri},${rj}`);
    }
    // Grid point (0, 0) is where the message says it is.
    const [lat0, lon0] = lambertInverse(nbmProj, 0, 0);
    assert.ok(Math.abs(lat0 - nbmGrid.lat1) < 1e-6 && Math.abs(lonDiff(lon0, nbmGrid.lon1)) < 1e-6);
});

// ── The fragment shader's float32 arithmetic against the float64 reference ──

const f = Math.fround;
/** `lccForward` from LAMBERT_GLSL with every operation rounded to float32, as the GPU computes it. */
function shaderForward(p, lng, lat) {
    const n = f(p.n), rF = f(p.rF), lov = f(p.lov * Math.PI / 180), x0 = f(p.x0), y0 = f(p.y0), dx = f(p.dx), dy = f(p.dy);
    const PI = f(Math.PI);
    const latRad = f(f(lat) * f(Math.PI / 180));
    let dlon = f(f(f(lng) * f(Math.PI / 180)) - lov);
    dlon = f(dlon - f(f(2 * PI) * Math.floor(f(f(dlon + PI) / f(2 * PI)))));
    const rho = f(rF / f(Math.pow(f(Math.tan(f(f(PI / 4) + f(latRad / 2)))), n)));
    const theta = f(n * dlon);
    return [f(f(f(rho * f(Math.sin(theta))) - x0) / dx), f(f(f(-rho * f(Math.cos(theta))) - y0) / dy)];
}

test('float32 shader arithmetic stays under 0.01 cell from the reference on both grids', () => {
    for (const [name, g, p] of [['HRRR', grid, proj], ['NBM', nbmGrid, nbmProj]]) {
        let worst = 0;
        for (let i = 0; i < g.nx; i += 97) {
            for (let j = 0; j < g.ny; j += 89) {
                const [lat, lon] = lambertInverse(p, i, j);
                const [si, sj] = shaderForward(p, lon, lat);
                worst = Math.max(worst, Math.hypot(si - i, sj - j));
            }
        }
        assert.ok(worst < 0.01, `${name}: worst error ${worst.toFixed(5)} cell`);
    }
});
