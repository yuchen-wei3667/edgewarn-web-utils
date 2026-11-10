import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findIdxEntry, getModelField, inputsFor } from '../dist/catalog.js';
import { getDataset } from '../dist/datasets.js';
import { decodeGrib2ToLevels, fromHalf, parseIdx, readGrib2Grid } from '@edgewarn/web-utils/grib2';
import { describeGrid, gridMismatch } from '../dist/gridMatch.js';
import { modelFileUrl } from '../dist/listing.js';
import { buildLatLonGrib } from '../../decoders/test/fixtures/models/lcc-grib-builder.mjs';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'gfs');
const idx = (step) => parseIdx(readFileSync(path.join(DIR, `gfs.t12z.pgrb2.0p25.f${String(step).padStart(3, '0')}.idx`), 'utf8'));
const gfs = getDataset('gfs');
const find = (fieldId, step) => {
    const def = getModelField(fieldId);
    return inputsFor(def, 'gfs').map((sel) => findIdxEntry(idx(step), sel, step * 60, gfs));
};

// ── Registry and URLs ──

test('GFS object URLs have no .grib2 suffix and pad the forecast hour to three digits', () => {
    const at = Date.UTC(2026, 9, 25, 12);
    assert.equal(modelFileUrl(gfs, at, 'pgrb', 6), 'https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.20261025/12/atmos/gfs.t12z.pgrb2.0p25.f006');
    assert.equal(modelFileUrl(gfs, at, 'pgrb', 123), 'https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.20261025/12/atmos/gfs.t12z.pgrb2.0p25.f123');
});

test('a GFS run is hourly to 120 h and every 3 hours to 384 h: 121 + 88 steps', () => {
    const steps = gfs.stepsFor(12);
    assert.equal(steps.length, 121 + 88);
    assert.equal(steps[120], 120 * 60);
    assert.equal(steps[121], 123 * 60);
    assert.equal(steps.at(-1), 384 * 60);
    assert.equal(gfs.runSteps(0), 384);
    assert.equal(gfs.fileIndexOf(123 * 60), 123);
});

test('the six-hour accumulation exists only at the steps that are multiples of 6 h', () => {
    const steps = gfs.fieldSteps('APCP_6H', 0);
    assert.equal(steps[0], 360);
    assert.ok(steps.every((m) => m % 360 === 0));
    assert.equal(steps.at(-1), 384 * 60);
    assert.equal(gfs.fieldSteps('APCP_TOTAL', 0), null);
    assert.equal(gfs.fieldSteps('HRRR_TMP_2M', 0), null);
});

// ── Catalog: windows longer than a step ──

test('every GFS field is found in the f012 inventory, with MSLP spelled PRMSL', () => {
    for (const id of ['HRRR_TMP_2M', 'HRRR_DPT_2M', 'HRRR_RH_2M', 'HRRR_WIND_10M', 'HRRR_GUST_SFC', 'HRRR_REFC', 'HRRR_SBCAPE', 'HRRR_PWAT', 'HRRR_PTYPE', 'HRRR_WIND_500MB', 'HRRR_HGT_850MB']) {
        assert.ok(find(id, 12).every(Boolean), id);
    }
    assert.equal(find('HRRR_MSLP', 12)[0].variable, 'PRMSL');
});

test('no dewpoint is offered on pressure levels, because GFS publishes none', () => {
    assert.equal(getModelField('HRRR_DPT_500MB').models.includes('gfs'), false);
    assert.equal(getModelField('HRRR_TMP_500MB').models.includes('gfs'), true);
});

test('APCP_6H finds 0-6, 6-12 and 12-18 hour accumulations and nothing at 13 h', () => {
    assert.equal(find('APCP_6H', 6)[0].forecast, '0-6 hour acc fcst');
    assert.equal(find('APCP_6H', 12)[0].forecast, '6-12 hour acc fcst');
    // f018 is not saved: an inventory line of its shape stands in.
    const f018 = parseIdx('596:1:d=2026102512:APCP:surface:12-18 hour acc fcst:\n597:2:d=2026102512:APCP:surface:0-18 hour acc fcst:\n');
    const sel = inputsFor(getModelField('APCP_6H'), 'gfs')[0];
    assert.equal(findIdxEntry(f018, sel, 1080, gfs).forecast, '12-18 hour acc fcst');
    assert.equal(find('APCP_6H', 13)[0], null, 'f013 holds a 1-hour bucket, not a 6-hour one');
    assert.equal(find('APCP_6H', 123)[0], null, 'f123 holds a 3-hour bucket');
    assert.equal(find('APCP_6H', 0)[0], null, 'the analysis has no accumulation');
});

test('APCP_TOTAL finds the run total at every step, including the day-labelled ones', () => {
    assert.equal(find('APCP_TOTAL', 13)[0].forecast, '0-13 hour acc fcst');
    assert.equal(find('APCP_TOTAL', 123)[0].forecast, '0-123 hour acc fcst');
    const day = parseIdx('596:1:d=2026102512:APCP:surface:114-120 hour acc fcst:\n597:2:d=2026102512:APCP:surface:0-5 day acc fcst:\n');
    const sel = inputsFor(getModelField('APCP_TOTAL'), 'gfs')[0];
    assert.equal(findIdxEntry(day, sel, 120 * 60, gfs).forecast, '0-5 day acc fcst');
});

test('an hourly model keeps its one-hour window; windowMinutes changes only the fields that set it', () => {
    const hrrr = getDataset('hrrr');
    const lines = parseIdx('1:0:d=2026101212:APCP:surface:5-6 hour acc fcst:\n2:9:d=2026101212:APCP:surface:0-6 hour acc fcst:\n');
    const oneHour = inputsFor(getModelField('HRRR_APCP_1H'), 'hrrr')[0];
    assert.equal(findIdxEntry(lines, oneHour, 360, hrrr).forecast, '5-6 hour acc fcst');
    const sixHour = { ...oneHour, windowMinutes: 360 };
    assert.equal(findIdxEntry(lines, sixHour, 360, hrrr).forecast, '0-6 hour acc fcst');
    assert.equal(findIdxEntry(lines, { ...oneHour, windowMinutes: 90 }, 360, hrrr), null, 'a window that is not whole hours matches nothing in an hour-labelled file');
});

// ── The declared grid, measured ──

test('the declared GFS grid is the one a real message carries', () => {
    const measured = JSON.parse(readFileSync(path.join(DIR, 'grid.json'), 'utf8')).grid;
    assert.equal(gridMismatch(gfs.grid, measured), null);
    assert.match(describeGrid(gfs.grid), /^1440x721 lat\/lon at 0\.25x0\.25 deg, first point 90, 0, scan 0x0, radius 6371229$/);
});

// ── Template 3.0 decode ──

const values = (nx, ny) => Array.from({ length: nx * ny }, (_, k) => k + 1);

test('a template 3.0 message reads as a lat/lon grid, rows north to south', () => {
    const grid = readGrib2Grid(buildLatLonGrib(values(8, 5), 8, 5, { shape: 6 }));
    assert.deepEqual([grid.projection, grid.nx, grid.ny, grid.lat1, grid.lon1, grid.dlat, grid.dlon, grid.scanMode, grid.radiusM],
        ['latlon', 8, 5, 90, 0, 0.25, 0.25, 0x00, 6371229]);
});

test('scan 0x00 decodes in file order: row 0 is the northernmost', () => {
    const msg = buildLatLonGrib(values(8, 5), 8, 5);
    const { levels: [l0] } = decodeGrib2ToLevels(msg, { factors: [1, 2, 4], levels: [0] });
    assert.deepEqual(Array.from(l0.data.slice(0, 8), fromHalf), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(fromHalf(l0.data[8 * 4 + 7]), 40);
});

test('levels decimate from the north-first grid, including the partial last block', () => {
    const msg = buildLatLonGrib(values(8, 5), 8, 5);
    const { levels: [, l1, l2] } = decodeGrib2ToLevels(msg, { factors: [1, 2, 4], levels: [0, 1, 2] });
    assert.deepEqual([l1.nx, l1.ny, l2.nx, l2.ny], [4, 3, 2, 2]);
    // The first level-1 texel is the mean of values 1, 2, 9, 10 (rows 0 and 1, columns 0 and 1).
    assert.equal(fromHalf(l1.data[0]), (1 + 2 + 9 + 10) / 4);
    // The last row is a block of one source row: values 33..40 averaged in pairs.
    assert.equal(fromHalf(l1.data[2 * 4]), (33 + 34) / 2);
});

test('scan 0x40 is accepted too, and names its row 0 as the southernmost', () => {
    const grid = readGrib2Grid(buildLatLonGrib(values(4, 3), 4, 3, { scanMode: 0x40, grid: { lat1: -10 } }));
    assert.deepEqual([grid.scanMode, grid.lat1], [0x40, -10]);
});

test('an unsupported lat/lon layout is refused with a message that names it', () => {
    const msg = (opts) => buildLatLonGrib(values(4, 3), 4, 3, opts);
    assert.throws(() => readGrib2Grid(msg({ scanMode: 0x80 })), /Scan mode 0x80 not supported/);
    assert.throws(() => readGrib2Grid(msg({ scanMode: 0x20 })), /Scan mode 0x20 not supported/);
    assert.throws(() => readGrib2Grid(msg({ basicAngle: 1 })), /non-zero basic angle/);
    assert.throws(() => readGrib2Grid(msg({ last: { lat: 0, lon: 0.75 } })), /extent does not match its increments/);
    assert.throws(() => readGrib2Grid(msg({ last: { lat: 89.5, lon: 1.5 } })), /extent does not match its increments/);
    assert.equal(readGrib2Grid(msg({ last: { lat: 89.5, lon: 0.75 } })).nx, 4, 'the stated last point that agrees is accepted');
});

test('gridMismatch names the lat/lon key that differs', () => {
    const declared = gfs.grid;
    assert.deepEqual(gridMismatch(declared, { ...declared, lat1: 89 }), ['lat1']);
    assert.deepEqual(gridMismatch(declared, { ...declared, dlon: 0.5, nx: 720 }), ['nx', 'dlon']);
    assert.deepEqual(gridMismatch(declared, { ...declared, scanMode: 0x40 }), ['scanMode']);
    assert.deepEqual(gridMismatch(declared, getDataset('hrrr').grid), ['projection']);
});
