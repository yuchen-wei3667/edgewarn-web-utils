import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeGrib2ToHalf } from '../../dist/grib2/models/grib2.js';
import { fromHalf } from '../../dist/grib2/models/half.js';
import { decodeCcsds, parseEcmwfIndex, registerPacking, CCSDS_TEMPLATE, decodeCcsdsField } from '../../dist/grib2/index.js';
registerPacking(CCSDS_TEMPLATE, decodeCcsdsField);

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'models', 'ecmwf-ifs');
const read = (name) => readFileSync(path.join(DIR, name));
const index = (step) => parseEcmwfIndex(read(`ifs.t00z.oper.f${String(step).padStart(3, '0')}.index`).toString('utf8'));
const reference = JSON.parse(read('reference.json').toString('utf8'));
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

test('lines that are not messages are skipped', () => {
    assert.deepEqual(parseEcmwfIndex(''), []);
    assert.deepEqual(parseEcmwfIndex('<?xml version="1.0"?>\n{"param":"2t"}\nnot json\n'), []);
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
