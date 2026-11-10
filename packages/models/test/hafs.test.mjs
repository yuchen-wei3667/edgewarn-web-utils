import test from 'node:test';
import assert from 'node:assert/strict';
import { getDataset } from '../dist/datasets.js';
import { groupModels } from '../dist/modelGroups.js';
import { setHafsStorm } from '../dist/configs/hafsStorm.js';

const urlOf = (id) => getDataset(id).url('20261029', 18, getDataset(id).fileOf('sfc', 'mean'), 12).replace(/^https:[^/]*\/\/[^/]*\//, '');

test('HAFS object paths carry the selected storm and the A/B prefix', () => {
    setHafsStorm('22e');
    assert.equal(urlOf('hafs-b'), 'hfsb/20261029/18/22e.2026102918.hfsb.storm.atm.f012.grb2');
    assert.equal(urlOf('hafs-a'), 'hfsa/20261029/18/22e.2026102918.hfsa.storm.atm.f012.grb2');
});

test('HAFS builds a path that cannot match a real storm when none is chosen, and rejects ids that are not storm ids', () => {
    setHafsStorm(null);
    assert.equal(urlOf('hafs-a'), 'hfsa/20261029/18/00x.2026102918.hfsa.storm.atm.f012.grb2');
    assert.throws(() => setHafsStorm('../x'), /Not a HAFS storm id/);
});

test('HAFS models form their own Hurricane group', () => {
    const groups = groupModels(['hrrr', 'hafs-a', 'hafs-b']);
    assert.deepEqual(groups.map((g) => g.id), ['convection-allowing', 'hurricane']);
    assert.deepEqual(groups[1].ids, ['hafs-a', 'hafs-b']);
});
