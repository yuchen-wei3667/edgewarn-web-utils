import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateDestination } from '@edgewarn/web-utils/geo';
import {
    bandCovers, boxRangeFrom, buildSweeps, cropField, groupTilts, lineRangeFrom, padBand, polarColumn, polarProfile, polarValueAt, rangeVerdict,
} from '../dist/nexrad/index.js';

const destination = (from, distanceM, bearing) => {
    const [lat, lng] = calculateDestination(from.lat, from.lng, distanceM, bearing);
    return { lat, lng };
};

const field = (extra = {}) => ({
    moment: 'REF', cut: 1, rows: 4, gates: 6, wordSize: 8, scale: 2, offset: 66, firstGateMeters: 2125, gateSpacingMeters: 250,
    data: new Uint8Array(24), azimuths: new Float32Array(4), azimuthLut: new Uint16Array(3600), elevation: 0.5, scanTimeMs: 0, complete: true, ...extra,
});

// A radar at (35, -97) with one flat sweep: code = 100 within the first 60 gates of every azimuth, elevation as given.
const SITE = { lat: 35, lon: -97, elevationMeters: 300 };
function sweep(elevation, code, extra = {}) {
    const rows = 360, gates = 400;
    const data = new Uint8Array(rows * gates).fill(code);
    const azimuths = Float32Array.from({ length: rows }, (_, i) => i);
    const azimuthLut = new Uint16Array(3600);
    for (let bin = 0; bin < 3600; bin++) azimuthLut[bin] = Math.min(rows - 1, Math.round(bin / 10)) % rows;
    return { elevationId: 0, field: field({ rows, gates, data, azimuths, azimuthLut, elevation, scale: 2, offset: 66, firstGateMeters: 2125, gateSpacingMeters: 250, cut: 1, ...extra }) };
}

test('buildSweeps orders by elevation, keeps the newer scan of a repeated elevation and drops empty cuts', () => {
    const a = { ...sweep(2.4, 100), elevationId: 3 }, b = { ...sweep(0.5, 100, { cut: 1 }), elevationId: 0 };
    const repeat = { ...sweep(0.52, 100, { cut: 5 }), elevationId: 4 }, empty = { ...sweep(4, 100, { rows: 0 }), elevationId: 5 };
    const sweeps = buildSweeps([a, repeat, empty, b]);
    assert.deepEqual(sweeps.map((s) => s.elevationId), [4, 3]);
});

test('a column reads the gate under each beam and the value follows height', () => {
    // Codes 100 and 140 -> (code - 66) / 2 = 17 and 37 dBZ.
    const sweeps = buildSweeps([{ ...sweep(0.5, 100), elevationId: 0 }, { ...sweep(2.0, 140), elevationId: 1 }]);
    const point = destination({ lat: SITE.lat, lng: SITE.lon }, 40_000, 90);
    const column = polarColumn(sweeps, SITE, point.lat, point.lng);
    assert.equal(column.count, 2);
    assert.ok(column.heightsKm[0] < column.heightsKm[1]);
    assert.equal(column.values[0], 17);
    assert.equal(column.values[1], 37);
    const mid = (column.heightsKm[0] + column.heightsKm[1]) / 2;
    assert.ok(Math.abs(polarValueAt(column, mid) - 27) < 1e-6);
    assert.equal(polarValueAt(column, column.heightsKm[0]), 17);
    assert.ok(Number.isNaN(polarValueAt(column, column.heightsKm[1] + 5)), 'above the top beam there is nothing');
    assert.ok(Number.isNaN(polarValueAt(column, column.heightsKm[0] - 5)), 'below the lowest beam there is nothing');
});

test('beyond the last gate and in the unscanned azimuths a beam has no value', () => {
    const sweeps = buildSweeps([{ ...sweep(0.5, 100), elevationId: 0 }]);
    // 400 gates * 250 m + 2125 m is about 102 km of slant range.
    const far = destination({ lat: SITE.lat, lng: SITE.lon }, 150_000, 45);
    assert.ok(Number.isNaN(polarColumn(sweeps, SITE, far.lat, far.lng).values[0]));
    const codes0 = sweeps[0].field.data.fill(1); // range folded or below threshold
    assert.ok(codes0.length > 0);
    const near = destination({ lat: SITE.lat, lng: SITE.lon }, 30_000, 10);
    assert.ok(Number.isNaN(polarColumn(sweeps, SITE, near.lat, near.lng).values[0]));
});

test('a profile line reads columns straight from the sweeps', () => {
    const sweeps = buildSweeps([{ ...sweep(0.5, 100), elevationId: 0 }]);
    const a = destination({ lat: SITE.lat, lng: SITE.lon }, 20_000, 90), b = destination({ lat: SITE.lat, lng: SITE.lon }, 60_000, 90);
    const columns = polarProfile(sweeps, SITE, a, b, 10);
    assert.equal(columns.length, 10);
    assert.ok(columns.every((c) => c.values[0] === 17));
    assert.ok(columns[9].heightsKm[0] > columns[0].heightsKm[0], 'the beam climbs with range');
});

test('range verdicts: inside, partly past the limit, and wholly out of range', () => {
    const limit = 300_000;
    const at = (m, bearing = 90) => destination({ lat: SITE.lat, lng: SITE.lon }, m, bearing);
    const near = lineRangeFrom(SITE, at(50_000), at(100_000));
    assert.ok(Math.abs(near.nearM - 50_000) < 600 && Math.abs(near.farM - 100_000) < 600);
    assert.equal(rangeVerdict(near, limit), 'inside');
    assert.equal(rangeVerdict(lineRangeFrom(SITE, at(250_000), at(350_000)), limit), 'partial');
    assert.equal(rangeVerdict(lineRangeFrom(SITE, at(320_000), at(400_000)), limit), 'outside');
    const east = at(330_000), far = at(420_000);
    assert.equal(rangeVerdict(boxRangeFrom(SITE, { west: east.lng, east: far.lng, south: SITE.lat - 0.3, north: SITE.lat + 0.3 }), limit), 'outside');
    // A box around the station is as near as it gets.
    const around = boxRangeFrom(SITE, { west: SITE.lon - 0.1, east: SITE.lon + 0.1, south: SITE.lat - 0.1, north: SITE.lat + 0.1 });
    assert.equal(around.nearM, 0);
    assert.equal(rangeVerdict(around, limit), 'inside');
});

test('cropping keeps the gates a band can use and reads the same values from them', () => {
    const full = buildSweeps([{ ...sweep(0.5, 100), elevationId: 0 }, { ...sweep(19.5, 140), elevationId: 1 }]);
    const band = { nearM: 30_000, farM: 70_000 };
    const cropped = full.map((s) => ({ ...s, field: cropField(s.field, band, SITE.elevationMeters, 20.5, 2000) }));
    assert.ok(cropped[0].field.gates < full[0].field.gates && cropped[0].field.data.length === cropped[0].field.rows * cropped[0].field.gates);
    // A 19.5 degree beam leaves the scene (20.5 km) near 58 km of ground range: its gates stop there, inside the band.
    const steep = cropped[1].field;
    const lastSlant = steep.firstGateMeters + (steep.gates - 1) * steep.gateSpacingMeters;
    assert.ok(lastSlant < 70_000 && lastSlant > 55_000, `last kept gate at ${lastSlant} m`);
    for (const distance of [32_000, 50_000, 68_000]) {
        const p = destination({ lat: SITE.lat, lng: SITE.lon }, distance, 135);
        assert.equal(polarColumn(cropped, SITE, p.lat, p.lng).values[0], polarColumn(full, SITE, p.lat, p.lng).values[0]);
    }
    assert.equal(cropField(full[0].field, { nearM: 0, farM: 1e6 }, 0, 100, 0), full[0].field, 'nothing to crop returns the same field');
    assert.equal(cropped[0].field.data.length < full[0].field.data.length / 2, true);
});

test('bands pad the shapes\' span, stay inside the radar and are covered by a wider one', () => {
    const band = padBand([{ nearM: 100_000, farM: 140_000 }], 300_000, 0.25);
    assert.deepEqual([band.nearM, band.farM], [90_000, 150_000]);
    assert.equal(padBand([{ nearM: 10_000, farM: 290_000 }], 300_000, 0.25).farM, 300_000);
    assert.equal(padBand([{ nearM: 5_000, farM: 20_000 }], 300_000, 0.25).nearM, 1250);
    assert.ok(bandCovers(band, { nearM: 95_000, farM: 145_000 }));
    assert.ok(!bandCovers(band, { nearM: 80_000, farM: 145_000 }));
});

test('tilts at one angle are one elevation; angles further apart than 0.3 degrees are two', () => {
    const tilt = (moment, elevation, elevationNumber) => ({ moment, product: 'x', header: { elevation, elevationNumber, vcp: 212 } });
    const groups = groupTilts([tilt('VEL', 0.5, 2), tilt('REF', 0.5, 1), tilt('REF', 1.3, 3), tilt('ZDR', 0.5, 1)]);
    assert.deepEqual(groups.map((g) => [g.nominalAngle, g.moments, g.cuts]), [[0.5, ['REF', 'VEL', 'ZDR'], [1, 2]], [1.3, ['REF'], [3]]]);
});
