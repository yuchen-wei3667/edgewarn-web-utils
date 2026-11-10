import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findIdxEntry, getModelField, inputsFor } from '../dist/catalog.js';
import { getDataset } from '../dist/datasets.js';
import { decodeCcsds, decodeGrib2ToHalf, fromHalf, parseEcmwfIndex } from '@edgewarn/web-utils/grib2';
import { loadSourceAdapter } from '../dist/sources/index.js';
import { modelFileUrl } from '../dist/listing.js';
import { probeUrlFor } from '../dist/sources/probe.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'ecmwf-ifs');
const read = (name) => readFileSync(path.join(DIR, name));
const index = (step) => parseEcmwfIndex(read(`ifs.t00z.oper.f${String(step).padStart(3, '0')}.index`).toString('utf8'));
const reference = JSON.parse(read('reference.json').toString('utf8'));
const ifs = getDataset('ecmwf-ifs');
// Loading the ECMWF adapter registers the CCSDS packing (5.42) with the decoder.
await loadSourceAdapter(ifs.source);
const find = (fieldId, step) => inputsFor(getModelField(fieldId), 'ecmwf-ifs').map((sel) => findIdxEntry(index(step), sel, step * 60, ifs));
/** Half a float16 step at v: the most round-to-nearest can move a value. */
const halfStep = (v) => Math.max(Math.abs(v), 2 ** -14) * 2 ** -11;

// ── CCSDS packing (template 5.42) ──

test('CCSDS messages decode to what ecCodes reads at every reference point', () => {
    for (const [name, ref] of Object.entries(reference)) {
        const { grid, data } = decodeGrib2ToHalf(new Uint8Array(read(name)));
        assert.equal(grid.nx * grid.ny, ref.n, name);
        assert.deepEqual([grid.lat1, grid.lon1, grid.scanMode], [90, 180, 0]);
        for (const [i, value] of ref.samples) {
            const got = fromHalf(data[i]);
            assert.ok(Math.abs(got - value) <= halfStep(value) + 1e-9, `${name} [${i}]: ${got} vs ${value}`);
        }
    }
});

test('a transform is folded into CCSDS unpacking too', () => {
    const ref = reference['t00z-f012-2t.grib2'];
    const { data } = decodeGrib2ToHalf(new Uint8Array(read('t00z-f012-2t.grib2')), { offset: -273.15 });
    for (const [i, value] of ref.samples) assert.ok(Math.abs(fromHalf(data[i]) - (value - 273.15)) <= halfStep(value - 273.15) + 1e-4);
});

/** Bits MSB first, for hand-built streams. */
function bitString(...parts) {
    const bits = parts.join('');
    const bytes = new Uint8Array(Math.ceil(bits.length / 8));
    for (let i = 0; i < bits.length; i++) if (bits[i] === '1') bytes[i >> 3] |= 0x80 >> (i & 7);
    return bytes;
}
const field = (value, width) => value.toString(2).padStart(width, '0');
const PREPROCESS = 8;

test('an uncompressed block is its samples, one after another', () => {
    const bytes = bitString('111', ...[1, 2, 3, 4, 5, 6, 7, 250].map((v) => field(v, 8)));
    assert.deepEqual([...decodeCcsds(bytes, { bitsPerSample: 8, blockSize: 8, rsi: 1, flags: 0, nSamples: 8 })], [1, 2, 3, 4, 5, 6, 7, 250]);
});

test('a zero-block code repeats the reference sample, and the predictor undoes the mapped deltas', () => {
    // id 000, option 0, reference 77, then a fundamental sequence 1 (one zero block): eight samples of 77.
    const zero = bitString('000', '0', field(77, 8), '1');
    assert.deepEqual([...decodeCcsds(zero, { bitsPerSample: 8, blockSize: 8, rsi: 1, flags: PREPROCESS, nSamples: 8 })], Array(8).fill(77));
    // A split with k = 1 (id 2): reference 10, seven mapped deltas 0,1,2,3,4,0,0 -> +0, -1, +1, -2, +2, +0, +0.
    const fs = (d) => '0'.repeat(d >> 1) + '1';
    const deltas = [0, 1, 2, 3, 4, 0, 0];
    const split = bitString('010', field(10, 8), ...deltas.map(fs), ...deltas.map((d) => String(d & 1)));
    assert.deepEqual([...decodeCcsds(split, { bitsPerSample: 8, blockSize: 8, rsi: 1, flags: PREPROCESS, nSamples: 8 })], [10, 10, 9, 10, 8, 10, 10, 10]);
});

test('the options the reader does not cover are refused, and a short stream is an error', () => {
    const p = { bitsPerSample: 8, blockSize: 8, rsi: 1, flags: 0, nSamples: 8 };
    assert.throws(() => decodeCcsds(new Uint8Array(4), { ...p, flags: 1 }), /signed/);
    assert.throws(() => decodeCcsds(new Uint8Array(4), { ...p, flags: 16 }), /restricted/);
    assert.throws(() => decodeCcsds(new Uint8Array(4), { ...p, blockSize: 12 }), /block size/);
    assert.throws(() => decodeCcsds(new Uint8Array(1), p), /ends before/);
});

// ── The inventory ──

test('an ECMWF .index becomes rows with NCEP-style levels and forecast columns', () => {
    const rows = index(12);
    const row = (variable, level) => rows.find((r) => r.variable === variable && r.level === level);
    assert.equal(rows.length, 191);
    assert.equal(row('2t', 'sfc').forecast, '12 hour fcst');
    assert.equal(row('tp', 'sfc').forecast, '0-12 hour acc fcst');
    assert.equal(row('mx2t3', 'sfc').forecast, '9-12 hour max fcst');
    assert.equal(row('mn2t3', 'sfc').forecast, '9-12 hour min fcst');
    assert.ok(row('gh', '500 mb') && row('t', '850 mb') && row('vsw', 'sol 1'));
    assert.equal(index(0).find((r) => r.variable === '2t').forecast, 'anl');
    assert.equal(index(150).find((r) => r.variable === 'mx2t6').forecast, '144-150 hour max fcst');
    const t2 = row('2t', 'sfc');
    assert.equal(t2.end - t2.start + 1, 316695, 'the inclusive end is offset + length - 1');
});

test('lines that are not messages are skipped', () => {
    assert.deepEqual(parseEcmwfIndex(''), []);
    assert.deepEqual(parseEcmwfIndex('<?xml version="1.0"?>\n{"param":"2t"}\nnot json\n'), []);
});

// ── The dataset ──

test('every field the dataset offers resolves in the f000, f012 and f150 inventories, or not at all where the step lacks it', () => {
    for (const step of [0, 12, 150]) {
        for (const id of ['HRRR_TMP_2M', 'HRRR_DPT_2M', 'HRRR_TMP_SFC', 'HRRR_WIND_10M', 'HRRR_GUST_SFC', 'HRRR_TCDC', 'HRRR_PWAT', 'HRRR_MUCAPE',
            'HRRR_WEASD', 'HRRR_PRATE', 'HRRR_TMP_500MB', 'HRRR_HGT_850MB', 'HRRR_RH_700MB', 'HRRR_WIND_250MB']) {
            assert.ok(find(id, step).every(Boolean), `${id} at +${step} h`);
        }
        assert.equal(find('HRRR_MSLP', step)[0].variable, 'msl');
    }
    assert.ok(find('APCP_TOTAL', 12)[0], 'a run total exists once a step has passed');
    assert.equal(find('APCP_TOTAL', 0)[0], null, 'and not at the analysis');
});

test('the dataset does not offer what ECMWF does not publish', () => {
    assert.equal(getModelField('HRRR_DPT_500MB').models.includes('ecmwf-ifs'), false);
    for (const id of ['HRRR_VIS', 'HRRR_REFC', 'HRRR_PTYPE', 'HRRR_SBCAPE', 'APCP_6H']) assert.equal(getModelField(id).models.includes('ecmwf-ifs'), false, id);
});

test('unit rewrites are folded in: cloud cover to percent, snow water and precipitation to millimetres', () => {
    const scale = (id) => inputsFor(getModelField(id), 'ecmwf-ifs').map((sel) => (ifs.components[`${sel.variable}|${sel.level}`]?.transform?.scale));
    assert.deepEqual(scale('HRRR_TCDC'), [100]);
    assert.deepEqual(scale('HRRR_WEASD'), [1000]);
    assert.deepEqual(scale('APCP_TOTAL'), [1000]);
});

test('URLs follow the open-data layout and the inventory sits beside the object with a .index extension', () => {
    const at = Date.UTC(2026, 9, 25, 6);
    const url = modelFileUrl(ifs, at, 'oper', 93);
    assert.equal(url, 'https://ecmwf-open-data.storage.googleapis.com/20261025/06z/ifs/0p25/oper/20261025060000-93h-oper-fc.grib2');
    assert.equal(probeUrlFor(ifs, url), url.replace(/\.grib2$/, '.index'));
    assert.equal(probeUrlFor(getDataset('gfs'), 'https://x/y'), 'https://x/y.idx');
});

test('00 and 12 UTC reach 240 h, 3-hourly then 6-hourly; 06 and 18 UTC stop at 144 h', () => {
    for (const cycle of [0, 12]) {
        const steps = ifs.stepsFor(cycle);
        assert.equal(steps.length, 49 + 16);
        assert.equal(steps.at(-1), 240 * 60);
        assert.ok(steps.includes(144 * 60) && steps.includes(150 * 60) && !steps.includes(147 * 60));
        assert.equal(ifs.runSteps(cycle), 240);
    }
    for (const cycle of [6, 18]) {
        assert.equal(ifs.stepsFor(cycle).length, 49);
        assert.equal(ifs.runSteps(cycle), 144);
    }
    assert.equal(ifs.minStep, 0);
});

test('the model is viewer-only and says whose data it is', () => {
    assert.deepEqual([...ifs.surfaces], ['viewer']);
    assert.match(ifs.about.attribution, /ECMWF/);
});
