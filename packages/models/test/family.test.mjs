import assert from 'node:assert/strict';
import test from 'node:test';
import { familyFieldModel, familyFields, familyModelIds, familyPanes, familyPickerIds, familyProduct, modelFamily } from '../dist/modelFamily.js';
import { getDataset, VIEWER_MODEL_IDS } from '../dist/datasets.js';

test('wave datasets share their parent picker entry without changing source identity', () => {
    const ids = familyPickerIds(VIEWER_MODEL_IDS);
    for (const parent of ['gfs', 'gefs']) {
        const wave = `${parent}-wave`;
        assert.ok(ids.includes(parent));
        assert.ok(!ids.includes(wave));
        assert.equal(modelFamily(wave), parent);
        assert.deepEqual(familyModelIds(wave), [parent, wave]);
        assert.equal(getDataset(wave).id, wave);
    }
    assert.deepEqual(familyPickerIds(['gefs-wave']), ['gefs-wave']);
    assert.deepEqual(familyModelIds('hrrr'), ['hrrr']);
});

test('both sources show atmospheric panes and one Wave tab with the correct field owner', () => {
    for (const model of ['gfs', 'gfs-wave', 'gefs', 'gefs-wave']) {
        const parent = modelFamily(model);
        const panes = familyPanes(model, 'mean');
        assert.ok(panes.some(p => p.id === 'surface'));
        assert.deepEqual(panes.filter(p => p.id === 'waves').map(p => p.label), ['Wave']);
        const fields = familyFields(model, 'mean');
        assert.equal(new Set(fields.map(f => f.id)).size, fields.length);
        assert.ok(fields.some(f => f.id === 'HRRR_TMP_2M'));
        assert.ok(fields.some(f => f.id === 'WAVE_HTSGW'));
        assert.equal(familyFieldModel(model, 'WAVE_HTSGW'), `${parent}-wave`);
        assert.equal(familyFieldModel(model, 'HRRR_TMP_2M'), parent);
    }
    assert.equal(getDataset('gefs').grid.nx, 720);
    assert.equal(getDataset('gefs-wave').grid.nx, 1440, 'wave grid stays native');
});

test('ensemble tabs retain supported statistics and fall back from normalized to raw wave spread', () => {
    for (const product of ['mean', 'sprd', 'member', 'min', 'max', 'exceed']) {
        assert.equal(familyProduct('gefs-wave', product), product);
        assert.equal(familyProduct('gefs', product), product);
        assert.ok(familyFields('gefs', product).some(f => f.id === 'WAVE_HTSGW'));
    }
    assert.equal(familyProduct('gefs-wave', 'nsprd'), 'sprd');
    assert.ok(familyFields('gefs', 'nsprd').some(f => f.id === 'WAVE_HTSGW'));
    assert.equal(familyProduct('gfs-wave', 'member'), 'mean');
});
