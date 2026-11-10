import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findIdxEntry, getModelField, inputsFor } from '../dist/catalog.js';
import { getDataset } from '../dist/datasets.js';
import { parseEcmwfIndex, parseIdx } from '@edgewarn/web-utils/grib2';
import { modelFileUrl } from '../dist/listing.js';
import { memberIds } from '../dist/ensemble.js';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const read = (f) => readFileSync(path.join(FIX, f), 'utf8');
const AT = Date.UTC(2026, 9, 25, 0);

test('GEFS member objects: control is gec00, members gepNN, statistics are their own objects', () => {
    const g = getDataset('gefs');
    const url = (file, member) => modelFileUrl(g, Date.UTC(2026, 9, 25, 12), file, 6, member);
    assert.ok(url('member', 0).endsWith('/gefs.20261025/12/atmos/pgrb2ap5/gec00.t12z.pgrb2a.0p50.f006'));
    assert.ok(url('member', 7).endsWith('/gep07.t12z.pgrb2a.0p50.f006'));
    assert.ok(url('member', 30).endsWith('/gep30.t12z.pgrb2a.0p50.f006'));
    assert.ok(url('avg').endsWith('/geavg.t12z.pgrb2a.0p50.f006'));
    assert.ok(url('spr').endsWith('/gespr.t12z.pgrb2a.0p50.f006'));
    assert.equal(g.capabilities.ensemble.members, 31);
    assert.equal(g.capabilities.ensemble.stats, 'files');
    assert.deepEqual([...g.capabilities.ensemble.computed], ['min', 'max', 'exceed']);
});

test('GEFS runs are 3-hourly to 240 h and 6-hourly to 384 h', () => {
    const steps = getDataset('gefs').stepsFor(0);
    assert.equal(steps.length, 81 + 24);
    assert.ok(steps.includes(240 * 60) && !steps.includes(243 * 60) && steps.includes(246 * 60) && steps.at(-1) === 384 * 60);
});

test('GEFS mean and spread are told apart by the descriptor column', () => {
    const g = getDataset('gefs');
    const sel = inputsFor(getModelField('HRRR_TMP_2M'), 'gefs')[0];
    const avg = parseIdx(read('gefs/geavg.t12z.pgrb2a.0p50.f006.idx'));
    const spr = parseIdx(read('gefs/gespr.t12z.pgrb2a.0p50.f006.idx'));
    assert.deepEqual(findIdxEntry(avg, sel, 360, g, 'mean').extra, ['ens mean']);
    assert.deepEqual(findIdxEntry(spr, sel, 360, g, 'sprd').extra, ['ens std dev']);
    assert.equal(findIdxEntry(avg, sel, 360, g, 'sprd'), null, 'the mean file has no spread component');
});

for (const [id, files, members, control] of [
    ['ecmwf-ifs-ens', ['ecmwf-ifs-ens/ifs-ens.t00z.ef.f012.index'], 50, false],
    ['ecmwf-aifs-ens', ['ecmwf-aifs-ens/aifs-ens.t00z.cf.f012.index', 'ecmwf-aifs-ens/aifs-ens.t00z.pf.f012.index'], 51, true],
]) {
    test(`${id}: every member resolves exactly one row per field input`, () => {
        const d = getDataset(id);
        const entries = files.flatMap((f) => parseEcmwfIndex(read(f)));
        const ids = memberIds(d.ensemble);
        assert.equal(ids.length, members);
        assert.equal(ids[0], control ? 0 : 1);
        for (const def of ['HRRR_TMP_2M', 'HRRR_HGT_500MB', 'APCP_TOTAL'].map(getModelField)) {
            for (const sel of inputsFor(def, id)) {
                for (const m of ids) {
                    const e = findIdxEntry(entries, sel, 720, d, 'member', m);
                    assert.ok(e, `${def.id} member ${m}`);
                    assert.equal(e.member, m);
                }
            }
        }
    });

    test(`${id}: an unknown member has no row`, () => {
        const d = getDataset(id);
        const entries = files.flatMap((f) => parseEcmwfIndex(read(f)));
        assert.equal(findIdxEntry(entries, inputsFor(getModelField('HRRR_TMP_2M'), id)[0], 720, d, 'member', 99), null);
    });
}

test('AIFS ENS reads its control from the cf object and the others from pf', () => {
    const d = getDataset('ecmwf-aifs-ens');
    assert.ok(modelFileUrl(d, AT, 'pf', 12, 0).endsWith('-12h-enfo-cf.grib2'));
    assert.ok(modelFileUrl(d, AT, 'pf', 12, 5).endsWith('-12h-enfo-pf.grib2'));
    assert.ok(modelFileUrl(d, AT, 'pf', 12).endsWith('-12h-enfo-pf.grib2'));
});

test('AIFS is labelled AI, and offers no humidity aloft', () => {
    for (const id of ['ecmwf-aifs', 'ecmwf-aifs-ens']) {
        const d = getDataset(id);
        assert.equal(d.about.category, 'ai');
        assert.match(d.about.attribution, /AI-generated/);
        assert.equal(getModelField('HRRR_RH_500MB').models.includes(id), false);
    }
});

test('IFS ENS runs thin out after 144 h only on the 06 and 18 UTC cycles', () => {
    const d = getDataset('ecmwf-ifs-ens');
    assert.equal(d.runSteps(0), 360);
    assert.equal(d.runSteps(12), 360);
    assert.equal(d.runSteps(6), 144);
    assert.equal(d.runSteps(18), 144);
});
