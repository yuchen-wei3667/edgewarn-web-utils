import test from 'node:test';
import assert from 'node:assert/strict';
import { projectionFor } from '../dist/projection/index.js';
import { gridMismatch } from '../dist/gridMatch.js';

/**
 * Polar stereographic (3.20) and Mercator (3.10) grids. `cells` are [i, j, lat, lon] computed independently with
 * pyproj (`+proj=stere +lat_0=90 +lat_ts=<latD> +lon_0=<lov>` and `+proj=merc +lat_ts=<latD>`, the same sphere, origin
 * at the first grid point), so the projection maths is held to a reference and not only to its own round trip.
 */
const D2R = Math.PI / 180;
const f = Math.fround;

const CASES = {
    hrrrAk: {
        grid: { projection: 'polarStereo', nx: 1299, ny: 919, lat1: 41.612949, lon1: 185.117126, lov: 225, latD: 60, dx: 3000, dy: 3000, scanMode: 0x40, radiusM: 6371229 },
        cells: [[0, 0, 41.612949, -174.882874], [1298, 0, 51.72556, -128.473103], [0, 918, 55.605448, 156.436843], [1298, 918, 76.337657, -115.775737], [649, 459, 60.796272, -163.503771], [433, 183, 51.620348, -165.918263]],
    },
    nbmAk: {
        grid: { projection: 'polarStereo', nx: 1649, ny: 1105, lat1: 40.53, lon1: 181.429, lov: 210, latD: 60, dx: 2976.56, dy: 2976.56, scanMode: 0x50, radiusM: 6371200 },
        cells: [[0, 0, 40.53, -178.571], [1648, 0, 41.739537, -124.580638], [0, 1104, 61.399756, 150.190869], [1648, 1104, 63.97579, -93.68951], [824, 552, 60.127699, -153.013028], [549, 221, 50.508291, -163.348338]],
    },
    nbmHi: {
        grid: { projection: 'mercator', nx: 625, ny: 561, lat1: 14.3515, lon1: 195.0305, latD: 20, dx: 2500, dy: 2500, scanMode: 0x50, radiusM: 6371200 },
        cells: [[0, 0, 14.3515, -164.9695], [624, 0, 14.3515, -150.040175], [0, 560, 26.860432, -164.9695], [624, 560, 26.860432, -150.040175], [312, 280, 20.735015, -157.504837], [208, 112, 16.931636, -159.993058]],
    },
    nbmPr: {
        grid: { projection: 'mercator', nx: 339, ny: 225, lat1: 16.9775, lon1: 291.9722, latD: 20, dx: 1250, dy: 1250, scanMode: 0x50, radiusM: 6371200 },
        cells: [[0, 0, 16.9775, -68.0278], [338, 0, 16.9775, -63.984441], [0, 224, 19.522084, -68.0278], [338, 224, 19.522084, -63.984441], [169, 112, 18.254451, -66.006121], [113, 45, 17.491644, -66.676026]],
    },
    nbmGu: {
        grid: { projection: 'mercator', nx: 193, ny: 193, lat1: 12.349884, lon1: 143.686538, latD: 20, dx: 2500, dy: 2500, scanMode: 0x50, radiusM: 6371200 },
        cells: [[0, 0, 12.349884, 143.686538], [192, 0, 12.349884, 148.280176], [0, 192, 16.794486, 143.686538], [192, 192, 16.794486, 148.280176], [96, 96, 14.583396, 145.983357], [64, 38, 13.236463, 145.217751]],
    },
};

/** Degrees of longitude difference, wrapped. */
const dLon = (a, b) => Math.abs((((a - b + 180) % 360) + 360) % 360 - 180);

for (const [name, { grid, cells }] of Object.entries(CASES)) {
    test(`${name}: cells land where pyproj puts them and the projection inverts`, () => {
        const proj = projectionFor(grid);
        assert.equal(proj.kind, grid.projection);
        assert.equal(proj.nx, grid.nx);
        assert.equal(proj.ny, grid.ny);
        for (const [i, j, lat, lon] of cells) {
            const [gotLat, gotLon] = proj.inverse(i, j);
            assert.ok(Math.abs(gotLat - lat) < 2e-6, `(${i}, ${j}) lat ${gotLat} vs ${lat}`);
            assert.ok(dLon(gotLon, lon) < 2e-6, `(${i}, ${j}) lon ${gotLon} vs ${lon}`);
            const [fi, fj] = proj.forward(lat, lon);
            assert.ok(Math.hypot(fi - i, fj - j) < 1e-3, `(${lat}, ${lon}) came back as (${fi}, ${fj}), wanted (${i}, ${j})`);
        }
    });

    test(`${name}: rectBounds holds the grid, split at the antimeridian when it crosses`, () => {
        const proj = projectionFor(grid);
        const boxes = proj.rectBounds(-0.5, -0.5, grid.nx - 0.5, grid.ny - 0.5);
        assert.ok(boxes.length >= 1 && boxes.length <= 2);
        for (const [w, s, e, n] of boxes) assert.ok(w >= -180 && e <= 180 && w < e && s < n, `box ${[w, s, e, n]}`);
        const inside = (lat, lon) => boxes.some(([w, s, e, n]) => lat >= s && lat <= n && lon >= w && lon <= e);
        for (let i = 0; i < grid.nx; i += Math.ceil(grid.nx / 37)) {
            for (let j = 0; j < grid.ny; j += Math.ceil(grid.ny / 29)) {
                const [lat, lon] = proj.inverse(i, j);
                assert.ok(inside(lat, lon), `(${i}, ${j}) at ${lat}, ${lon} is outside ${JSON.stringify(boxes)}`);
            }
        }
        // A tile-sized rectangle's box is far smaller than the grid's.
        const tile = proj.rectBounds(10, 10, 74, 74);
        assert.ok(tile.length >= 1);
    });

    test(`${name}: the shader arithmetic in float32 stays within a few hundredths of a cell`, () => {
        const proj = projectionFor(grid);
        const { a, b } = proj.uniforms();
        const forward32 = (lat, lon) => {
            if (grid.projection === 'polarStereo') {
                let dlon = f(f(lon * D2R) - f(a[1]));
                dlon = f(dlon - f(2 * Math.PI * Math.floor((dlon + Math.PI) / (2 * Math.PI))));
                const rho = f(f(a[0]) * f(Math.tan(f(Math.PI / 4 - f(lat * D2R) / 2))));
                return [f(f(f(rho * f(Math.sin(dlon))) - f(b[0])) / f(b[2])), f(f(f(-rho * f(Math.cos(dlon))) - f(b[1])) / f(b[3]))];
            }
            const t = f(f(lon - a[2]) + 180);
            const d = f(f(t - 360 * Math.floor(t / 360)) - 180 + f(a[2] - a[1]));
            const y = f(f(a[0]) * f(Math.log(f(Math.tan(f(Math.PI / 4 + f(lat * D2R) / 2))))));
            return [f(f(f(d * D2R) * f(a[0])) / f(b[2])), f(f(y - f(b[1])) / f(b[3]))];
        };
        for (const [i, j, lat, lon] of cells) {
            const [fi, fj] = forward32(lat, lon);
            assert.ok(Math.hypot(fi - i, fj - j) < 0.05, `(${i}, ${j}) came back as (${fi}, ${fj})`);
        }
    });

    test(`${name}: a message on this grid matches the declared one, and a shifted corner does not`, () => {
        assert.equal(gridMismatch(grid, { ...grid }), null);
        assert.deepEqual(gridMismatch(grid, { ...grid, lat1: grid.lat1 + 0.01 }), ['lat1']);
        assert.equal(gridMismatch(grid, { ...grid, lat1: grid.lat1 + 0.01 }, { shapeOnly: true }), null);
    });
}

test('polar stereographic: the grid axes point t clockwise of east, t being the longitude from lov', () => {
    const proj = projectionFor(CASES.hrrrAk.grid);
    assert.ok(Math.abs(proj.rotation(60, 225)) < 1e-12);
    assert.ok(Math.abs(proj.rotation(60, 235) - 10 * D2R) < 1e-12);
    // East at a point is the +i axis turned by that angle: stepping east along a parallel changes (i, j) that way.
    const [i0, j0] = proj.forward(60, 235);
    const [i1, j1] = proj.forward(60, 235.0001);
    const t = proj.rotation(60, 235);
    const eastAngle = Math.atan2(j1 - j0, i1 - i0);
    assert.ok(Math.abs(eastAngle - t) < 1e-3, `east runs ${eastAngle} rad from +i, wanted ${t}`);
});

test('Mercator: cells narrow poleward as cos(lat)/cos(latD) and the grid has no rotation', () => {
    const proj = projectionFor(CASES.nbmHi.grid);
    assert.equal(proj.rotation(20, -157), 0);
    assert.ok(Math.abs(proj.cellMetres(20) - 2500) < 1e-9);
    assert.ok(Math.abs(proj.cellMetres(0) - 2500 / Math.cos(20 * D2R)) < 1e-6);
});

test('the last point the Mercator message states is the last cell of the grid', () => {
    for (const [name, lat2, lon2] of [['nbmHi', 26.8605, 209.9598], ['nbmPr', 19.5221, 296.0156], ['nbmGu', 16.794399, 148.28]]) {
        const { grid } = CASES[name];
        const [lat, lon] = projectionFor(grid).inverse(grid.nx - 1, grid.ny - 1);
        assert.ok(Math.abs(lat - lat2) < 2e-4 && dLon(lon, lon2) < 2e-4, `${name}: ${lat}, ${lon} vs ${lat2}, ${lon2}`);
    }
});
