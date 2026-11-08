import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSounding, dcapeColumn, showalter, liftColumn, surfaceParcelDef, capeCheckColumn } from '@edgewarn/web-utils/met';
import { unstableColumn, straightWinds } from './helpers.mjs';

test('M3: DCAPE preserves SHARPpy local gravity 9.8, not 9.80665', () => {
    assert.ok(Math.abs(dcapeColumn(unstableColumn()) - 231.82602757840453) < 1e-9);
});

test('M4: default lift and screening meshes remain 5 and 10 hPa', () => {
    const col = unstableColumn();
    const def = surfaceParcelDef(col);
    assert.deepEqual(liftColumn(col, def), liftColumn(col, def, 5));
    assert.deepEqual(capeCheckColumn(col, def), capeCheckColumn(col, def, 10));
});

test('M6: fewer than two levels and mismatched heights reject explicitly', () => {
    for (const length of [0, 1]) {
        assert.throws(() => analyzeSounding({ ...unstableColumn(), p: new Float32Array(length) }), { message: 'sounding: structurally empty column' });
    }
    assert.throws(() => analyzeSounding({ ...unstableColumn(), z: new Float32Array(2) }), { message: 'sounding: structurally empty column' });
});

test('M7: FIFO cache holds 32 entries; reading an old entry does not refresh it', () => {
    const column = validMs => ({ ...unstableColumn(), validMs });
    const first = analyzeSounding(column(10000));
    for (let i = 1; i < 32; i++) analyzeSounding(column(10000 + i));
    assert.strictEqual(analyzeSounding(column(10000)), first);
    analyzeSounding(column(10032));
    assert.notStrictEqual(analyzeSounding(column(10000)), first);
});

test('M7: hashing respects Float32 subarray offsets and ignores surrounding bytes', () => {
    const col = unstableColumn(...straightWinds());
    const expected = analyzeSounding(col);
    const offset = { ...col };
    for (const field of ['p', 'z', 't', 'td', 'u', 'v']) {
        const buffer = new Float32Array(col[field].length + 2).fill(-999);
        buffer.set(col[field], 1);
        offset[field] = buffer.subarray(1, -1);
    }
    assert.strictEqual(analyzeSounding(offset), expected);
});

test('M10: Showalter delegates lifting and analysis uses the lifted index', () => {
    const col = unstableColumn();
    let calls = 0;
    assert.equal(showalter(col, (input, def) => {
        assert.strictEqual(input, col);
        assert.equal(def.p, 850);
        calls++;
        return 123;
    }), 123);
    assert.equal(calls, 1);
    assert.equal(analyzeSounding(col).thermo.showalter, showalter(col, (c, def) => liftColumn(c, def)?.li ?? null));
});
