import test from 'node:test';
import assert from 'node:assert/strict';
import {
    GOES_BANDS, GOES_SECTORS, getGoesBand, getGoesSector, lonLatToPixel, lonLatToScan, mcmipShift, pixelToLonLat, pyramidFromWire, zenithDeg,
} from '../dist/goes/index.js';

const texelToPixel = (t, level) => t * 2 ** level + (2 ** level - 1) / 2;
const pixelToTexel = (p, level) => (p - (2 ** level - 1) / 2) / 2 ** level;

// Grids read from GOES-19 files of 2026-284 12:01Z.
const PROJ = { perspectivePointHeight: 35786023, semiMajorAxis: 6378137, semiMinorAxis: 6356752.31414, lon0: -75, scale: 1, offset: 0, fill: 65535 };
const C13 = { ...PROJ, x0: -0.10133200138807297, y0: 0.12821200489997864, dx: 0.000056000000768108293, dy: -0.000056000000768108293, width: 2500, height: 1500 };
const C02 = { ...PROJ, x0: -0.1013529971241951, y0: 0.12823300063610077, dx: 0.000014000000192027073, dy: -0.000014000000192027073, width: 10000, height: 6000 };
const M1 = { ...PROJ, x0: -0.01397200021892786, y0: 0.1198119968175888, dx: 0.000056000000768108293, dy: -0.000056000000768108293, width: 500, height: 500 };

test('inverse projection matches the GOES-R PUG worked example', () => {
    const g = pyramidFromWire(C13);
    const s = lonLatToScan(g, -84.690932, 33.846162);
    assert.ok(Math.abs(s.x - -0.024052) < 1e-6, `x ${s.x}`);
    assert.ok(Math.abs(s.y - 0.095340) < 1e-6, `y ${s.y}`);
});

test('forward and inverse projection round-trip to well under a pixel', () => {
    const g = pyramidFromWire(C02);
    let worst = 0;
    for (let row = 0; row < g.height; row += 397) {
        for (let col = 0; col < g.width; col += 613) {
            const ll = pixelToLonLat(g, col, row);
            if (!ll) continue;
            const back = lonLatToPixel(g, ll.lon, ll.lat);
            worst = Math.max(worst, Math.abs(back.col - col), Math.abs(back.row - row));
        }
    }
    assert.ok(worst < 1e-6, `worst round-trip error ${worst} px`);
    // Off the disk there is no answer, either way.
    assert.equal(pixelToLonLat(g, 0, 0), null, 'the CONUS NW corner looks past the limb');
    assert.equal(lonLatToScan(g, 105, 0), null, 'the far side of the earth is not visible');
});

test('known cities land where the fixed grid puts them, and zenith grows towards the limb', () => {
    const g = pyramidFromWire(C13);
    const miami = lonLatToPixel(g, -80.19, 25.76);
    assert.ok(miami.col > 0 && miami.col < g.width && miami.row > 0 && miami.row < g.height);
    const z = (lon, lat) => zenithDeg(g, lon, lat);
    assert.ok(Math.abs(z(-80.19, 25.76) - 31) < 2, `Miami ${z(-80.19, 25.76)}`);
    assert.ok(Math.abs(z(-122.33, 47.61) - 71) < 2, `Seattle ${z(-122.33, 47.61)}`);
    assert.ok(z(-75, 0) < 0.01, 'the sub-satellite point looks straight up');
});

test('MCMIP and the band file describe the same pyramid', () => {
    const native = pyramidFromWire(C02);
    const fromMcmip = pyramidFromWire({ ...C13 }, 2);
    assert.equal(fromMcmip.id, native.id);
    assert.equal(fromMcmip.width, 10000);
    assert.ok(Math.abs(fromMcmip.x0 - native.x0) < 1e-7, "the files store axes as float32, so allow 0.01 pixel");
    // A 2 km pixel centre is the centre of its 4 x 4 block of 0.5 km pixels.
    assert.ok(Math.abs(texelToPixel(7, 2) - (7 * 4 + 1.5)) < 1e-12);
    assert.equal(pixelToTexel(texelToPixel(3.25, 5), 5), 3.25);
    assert.notEqual(pyramidFromWire(M1).id, pyramidFromWire(C13).id, 'a mesoscale box is its own grid');
});

test('MCMIP takes over at 2 km on CONUS only, and never for 2 km bands', () => {
    const conus = getGoesSector('C'), meso = getGoesSector('M1');
    const c02 = getGoesBand('GOES_ABI_C02_Reflectance'), c03 = getGoesBand('GOES_ABI_C03_Reflectance'), c13 = getGoesBand('GOES_ABI_C13_BrightnessTemp');
    assert.deepEqual([0, 1, 2, 3, 6].map((l) => mcmipShift(c02, conus, l)), [0, 0, 2, 2, 2]);
    assert.deepEqual([0, 1, 5].map((l) => mcmipShift(c03, conus, l)), [0, 1, 1]);
    assert.deepEqual([0, 4].map((l) => mcmipShift(c13, conus, l)), [0, 0]);
    assert.deepEqual([0, 6].map((l) => mcmipShift(c02, meso, l)), [0, 0]);
    assert.deepEqual(GOES_BANDS.filter((b) => b.nativeKm < 2).map((b) => b.band), [1, 2, 3, 5]);
    assert.equal(GOES_SECTORS.length, 4);
    const disk = getGoesSector('F');
    assert.deepEqual([0, 1, 2, 6].map((l) => mcmipShift(c02, disk, l)), [0, 0, 2, 2], 'full disk reads MCMIPF for coarse 0.5 km levels');
    assert.deepEqual([0, 1, 5].map((l) => mcmipShift(c03, disk, l)), [0, 1, 1]);
    assert.equal(disk.cadenceMin, 10);
});

