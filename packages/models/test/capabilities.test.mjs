import test from 'node:test';
import assert from 'node:assert/strict';
import { getDataset } from '../dist/datasets.js';

/**
 * Capabilities are derived from config, never declared. This table is hand-checked against what each model
 * is: a derivation that drifts from the engine fails here.
 */

const LEVELS = [925, 850, 700, 500, 250];

const TABLE = {
    hrrr: { projection: 'lambert', coverage: 'regional', maxLeadHours: 48, stepMinutes: 60, subHourly: false, analysis: true, thinnedFields: false, products: ['mean'], isobars: true, barbs: true, pressureLevels: LEVELS, discovery: 'probe' },
    'hrrr-subh': { projection: 'lambert', coverage: 'regional', maxLeadHours: 18, stepMinutes: 15, subHourly: true, analysis: true, thinnedFields: false, products: ['mean'], isobars: true, barbs: true, pressureLevels: [], discovery: 'probe' },
    rrfs: { projection: 'lambert', coverage: 'regional', maxLeadHours: 84, stepMinutes: 60, subHourly: false, analysis: true, thinnedFields: false, products: ['mean'], isobars: true, barbs: true, pressureLevels: LEVELS, discovery: 'probe' },
    'rrfs-subh': { projection: 'lambert', coverage: 'regional', maxLeadHours: 18, stepMinutes: 15, subHourly: true, analysis: false, thinnedFields: false, products: ['mean'], isobars: true, barbs: true, pressureLevels: [], discovery: 'probe' },
    refs: { projection: 'lambert', coverage: 'regional', maxLeadHours: 60, stepMinutes: 60, subHourly: false, analysis: false, thinnedFields: false, products: ['mean', 'sprd', 'prob'], isobars: true, barbs: true, pressureLevels: LEVELS, discovery: 'probe' },
    nbm: { projection: 'lambert', coverage: 'regional', maxLeadHours: 264, stepMinutes: 60, subHourly: false, analysis: false, thinnedFields: true, products: ['mean', 'p10', 'p50', 'p90'], isobars: false, barbs: true, pressureLevels: [], discovery: 'probe' },
    gfs: { projection: 'latlon', coverage: 'global', maxLeadHours: 384, stepMinutes: 60, subHourly: false, analysis: true, thinnedFields: true, products: ['mean'], isobars: true, barbs: true, pressureLevels: LEVELS, discovery: 'probe' },
};

for (const [id, want] of Object.entries(TABLE)) {
    test(`${id}: derived capabilities`, () => {
        const got = getDataset(id).capabilities;
        for (const [key, value] of Object.entries(want)) assert.deepEqual(got[key], value, key);
    });
}

test('profiles: a point column source, own or borrowed, and nothing for the models with too few levels', () => {
    const profiles = (id) => getDataset(id).capabilities.profiles;
    for (const id of ['hrrr', 'rrfs', 'gfs', 'aigfs', 'ecmwf-ifs', 'ecmwf-aifs', 'arpege-world']) assert.equal(profiles(id), 'column', id);
    for (const id of ['hrrr-subh', 'rrfs-subh']) assert.equal(profiles(id), 'column', `${id} borrows its hourly parent's`);
    for (const id of ['refs', 'nbm', 'gefs', 'ecmwf-ifs-ens', 'ecmwf-aifs-ens']) assert.equal(profiles(id), null, id);
});

test('bounds: CONUS for the HRRR grid, the whole globe for GFS', () => {
    const [w, s, e, n] = getDataset('hrrr').capabilities.bounds;
    assert.ok(w < -130 && w > -140 && e > -62 && e < -58 && s > 20 && s < 23 && n > 51 && n < 54, `${w} ${s} ${e} ${n}`);
    assert.deepEqual([...getDataset('gfs').capabilities.bounds], [-180, -90, 180, 90]);
});

test('panes: the 15-minute products fill fewer panes than their hourly twin; GFS has the severe pane', () => {
    const panes = (id) => getDataset(id).capabilities.panes;
    assert.ok(panes('hrrr-subh').length < panes('hrrr').length);
    assert.ok(panes('gfs').includes('severe'));
    assert.ok(!panes('refs').includes('probability'));
});
