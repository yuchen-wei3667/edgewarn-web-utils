import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getDataset, VIEWER_MODEL_IDS } from '../dist/datasets.js';
import { loadSourceAdapter } from '../dist/sources/index.js';
import { countPublishedSteps, makeRangeProbe, modelFileUrl, ModelHostError } from '../dist/listing.js';
import { projectionFor } from '../dist/projection/index.js';
import { gridMismatch } from '../dist/gridMatch.js';
import { fromHalf, levelFromValues } from '@edgewarn/web-utils/grib2';

const initMs = Date.UTC(2026, 10, 1, 12);

for (const [id, category, hours] of [['gem-rdps', 'regional', 84], ['gem-gdps', 'global', 240]]) {
    test(`${id}: belongs to its viewer group and reads directly from the approved OM bucket`, () => {
        const d = getDataset(id);
        assert.ok(VIEWER_MODEL_IDS.includes(id));
        assert.equal(d.about.category, category);
        assert.equal(d.runSteps(12), hours);
        assert.equal(d.source.kind, 'om');
        assert.equal(d.factors[0], 1, 'the finest level preserves every native grid cell');
        assert.match(modelFileUrl(d, initMs, d.files[0], 6), /^https:\/\/openmeteo\.s3\.amazonaws\.com\/data_spatial\//);
        assert.match(d.about.attribution, /Open-Meteo/);
    });
    test(`${id}: discovery uses the native run manifest and respects a publication gap`, async () => {
        const d = getDataset(id), files = JSON.parse(readFileSync(new URL(`./fixtures/${id}/manifests.json`, import.meta.url), 'utf8'));
        const manifest = files[d.files[0]], log = [];
        let response = manifest;
        const probe = makeRangeProbe({ fetch: async (url, options) => {
            log.push(url);
            assert.equal(options.cache, 'no-store');
            assert.equal(options.headers, undefined);
            return new Response(JSON.stringify(response));
        } });
        assert.equal(await countPublishedSteps(d, initMs, probe), hours + 1);
        assert.equal(log.length, 1);
        assert.ok(log[0].endsWith('/2026/11/01/1200Z/meta.json'));
        response = { ...manifest, valid_times: manifest.valid_times.filter((_, k) => k !== 2) };
        assert.equal(await countPublishedSteps(d, initMs, probe), 2);
        response = { ...manifest, reference_time: '2026-10-31T12:00:00Z' };
        await assert.rejects(countPublishedSteps(d, initMs, probe), /Invalid forecast run manifest/);
        assert.equal(await countPublishedSteps(d, initMs, makeRangeProbe({ fetch: async () => new Response(null, { status: 404 }) })), 0);
        await assert.rejects(countPublishedSteps(d, initMs, makeRangeProbe({ fetch: async () => { throw new Error('Offline'); } })), ModelHostError);
    });
}

test('GDPS keeps hourly surface frames and three-hour pressure frames on their own streams', () => {
    const d = getDataset('gem-gdps');
    assert.ok(d.stepsFor(12).includes(84 * 60));
    assert.ok(!d.stepsFor(12).includes(85 * 60));
    assert.ok(d.stepsFor(12).includes(87 * 60));
    assert.equal(d.fieldSteps('HRRR_TMP_2M', 12), null);
    assert.ok(!d.fieldSteps('HRRR_TMP_500MB', 12).includes(60));
    assert.ok(d.fieldSteps('HRRR_TMP_500MB', 12).includes(180));
    assert.match(modelFileUrl(d, initMs, d.fileOf('prs', 'mean'), 24), /cmc_gem_gdps_15km_upper_level\/2026\/11\/01\/1200Z\/2026-11-02T1200.om$/);
    assert.match(modelFileUrl(d, initMs, d.fileOf('sfc', 'mean'), 24), /cmc_gem_gdps_15km\/2026\/11\/01\/1200Z\/2026-11-02T1200.om$/);
});

// The Open-Meteo reader is GPL-2.0 and stays in the website: the package never loads it, and a host passes its own.
test('an om source needs the host to pass its adapter loader; the package ships none', async () => {
    const source = getDataset('gem-rdps').source;
    await assert.rejects(loadSourceAdapter(source), /needs the host to pass an `om` adapter loader/);
    const adapter = { readInputs: async () => { throw new Error('not called'); } };
    assert.equal(await loadSourceAdapter(source, { om: async () => adapter }), adapter);
});

test('OM and GRIB share missing-aware reducers, transforms and partial edge handling', () => {
    const values = Float32Array.of(1, 2, NaN, 4, 5, 6, 7, 8, 9);
    const mean = levelFromValues(values, 3, 3, 1, 2, 'mean', { scale: 2, offset: -1 });
    assert.deepEqual([...mean.data].map(fromHalf), [5, 11, 14, 17]);
    assert.deepEqual([...levelFromValues(values, 3, 3, 1, 2, 'max').data].map(fromHalf), [5, 6, 8, 9]);
    assert.ok(Number.isNaN(fromHalf(levelFromValues(Float32Array.of(NaN, 99), 2, 1, 0, 1, 'mean', {}, 50).data[1])));
    assert.equal(fromHalf(levelFromValues(Float32Array.of(1, 2, 1, 2), 2, 2, 1, 2, 'mode').data[0]), 2);
});

test('RDPS rotated axes preserve coordinates and give a distinct projection/cache identity', () => {
    const grid = getDataset('gem-rdps').grid, p = projectionFor(grid);
    const i = (360 - grid.lon1) / grid.dlon, j = -grid.lat1 / grid.dlat;
    const [lat, lon] = p.inverse(i, j);
    assert.ok(Math.abs(lat - (90 + grid.rotation.southPoleLat)) < 1e-9);
    assert.ok(Math.abs(lon - (grid.rotation.southPoleLon - 360)) < 1e-9);
    assert.ok(Math.abs(p.rotation(lat, lon)) < 1e-9);
    assert.equal(p.uniforms().kind, 4);
    assert.notEqual(p.key, projectionFor({ ...grid, rotation: undefined }).key);
    assert.deepEqual(gridMismatch(grid, { ...grid, rotation: undefined }), ['rotation']);
    for (const cell of [[0, 0], [1139, 1044], [400, 350], [650, 450]]) {
        const back = p.forward(...p.inverse(...cell));
        assert.ok(Math.hypot(back[0] - cell[0], back[1] - cell[1]) < 1e-6);
    }
});
