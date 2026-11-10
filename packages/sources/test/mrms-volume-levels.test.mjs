import test from 'node:test';
import assert from 'node:assert/strict';
import { VOLUME_FIELDS, anchorProductId, loadOrder, volumeLevels, getMrmsProduct } from '@edgewarn/web-utils/mrms';

test('each field has 33 levels in ascending order from 0.5 to 19 km', () => {
    for (const field of VOLUME_FIELDS) {
        const levels = volumeLevels(field.id);
        assert.equal(levels.length, 33, field.id);
        assert.equal(levels[0].levelKm, 0.5);
        assert.equal(levels.at(-1).levelKm, 19);
        for (let i = 1; i < levels.length; i++) assert.ok(levels[i].levelKm > levels[i - 1].levelKm);
    }
});

test('levels spaced 0.25 km up to 3, 0.5 km up to 9, then 1 km', () => {
    const km = volumeLevels('reflectivity').map((l) => l.levelKm);
    for (let i = 1; i < km.length; i++) {
        const gap = km[i] - km[i - 1];
        assert.equal(gap, km[i - 1] < 3 ? 0.25 : km[i - 1] < 9 ? 0.5 : 1, `${km[i - 1]} to ${km[i]}`);
    }
});

test('only the three 3D mosaic families are ever listed, and they match the catalog', () => {
    const allowed = /^(MergedReflectivityQC|MergedZdr|MergedRhoHV)_\d\d\.\d\d$/;
    for (const field of VOLUME_FIELDS) {
        for (const level of volumeLevels(field.id)) {
            assert.match(level.productId, allowed);
            assert.ok(level.productId.startsWith(field.familyId));
            assert.equal(getMrmsProduct(level.productId)?.family?.levelKm, level.levelKm);
        }
    }
    assert.equal(anchorProductId('zdr'), 'MergedZdr_00.50');
});

test('load order starts with the coarse seeds and covers every level once', () => {
    const km = volumeLevels('reflectivity').map((l) => l.levelKm);
    const order = loadOrder(km);
    assert.deepEqual(order.slice(0, 6).map((i) => km[i]), [0.5, 3, 6, 10, 14, 19]);
    assert.equal(new Set(order).size, km.length);
    assert.equal(order.length, km.length);
    // after the seeds, each pick is the level farthest from those already chosen
    const chosen = order.slice(0, 6);
    const next = order[6];
    const gap = (i) => Math.min(...chosen.map((c) => Math.abs(km[i] - km[c])));
    for (let i = 0; i < km.length; i++) if (!chosen.includes(i)) assert.ok(gap(next) >= gap(i));
});
