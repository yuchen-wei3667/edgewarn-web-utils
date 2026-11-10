import { APPROVED_DATA_ORIGINS } from '../dist/configs/shared.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    chooseModelStep, countPublishedSteps, findNewestRun, HOUR_MS, modelFileUrl, listRecentRuns,
    roundStep, runCycle, stepIndexOf,
} from '../dist/listing.js';
import { getDataset, MODEL_DATASETS } from '../dist/datasets.js';

const T = (s) => Date.parse(s);
const hrrr = getDataset('hrrr');

/**
 * Fake bucket over every dataset's real URL layout. `runs` maps init ms -> published step count;
 * `files` optionally holds a per-file override, so a step counts only once all of a dataset's
 * gating files are out. Records every probe URL.
 */
function fakeBucket(runs, files = {}, id = 'hrrr') {
    const probes = [];
    const dataset = getDataset(id);
    const probe = async (url) => {
        probes.push(url);
        if (dataset.id === 'hrrr') {
            const m = /hrrr\.(\d{8})\/conus\/hrrr\.t(\d{2})z\.wrf(sfc|prs|subh)f(\d{2})\.grib2\.idx$/.exec(url);
            assert.ok(m, url);
            const init = Date.UTC(+m[1].slice(0, 4), +m[1].slice(4, 6) - 1, +m[1].slice(6), +m[2]);
            const count = (files[m[3]] ?? runs).get(init) ?? 0;
            return Number(m[4]) < count;
        }
        if (dataset.id === 'hrrr-subh') {
            const m = /hrrr\.(\d{8})\/conus\/hrrr\.t(\d{2})z\.wrfsubhf(\d{2})\.grib2\.idx$/.exec(url);
            assert.ok(m, url);
            const init = Date.UTC(+m[1].slice(0, 4), +m[1].slice(4, 6) - 1, +m[1].slice(6), +m[2]);
            return Number(m[3]) < (runs.get(init) ?? 0);
        }
        if (dataset.id === 'refs') {
            const m = /refs\.(\d{8})\/(\d{2})\/ensprod\/refs\.t(\d{2})z\.(mean|sprd|prob)\.f(\d{2})\.conus\.grib2\.idx$/.exec(url);
            assert.ok(m, url);
            const init = Date.UTC(+m[1].slice(0, 4), +m[1].slice(4, 6) - 1, +m[1].slice(6), +m[2]);
            return Number(m[5]) < (files[m[4]] ?? runs).get(init) ?? 0;
        }
        const m = /rrfs\.(\d{8})\/(\d{2})\/rrfs\.t(\d{2})z\.(2dfld|prslev)\.3km(\.subh)?\.f(\d{3})\.conus\.grib2\.idx$/.exec(url);
        assert.ok(m, url);
        const init = Date.UTC(+m[1].slice(0, 4), +m[1].slice(4, 6) - 1, +m[1].slice(6), +m[2]);
        const key = m[6] ? 'subh' : m[4];
        return Number(m[7]) < (files[key] ?? runs).get(init) ?? 0;
    };
    return { probe, probes };
}

test('file URLs follow each dataset\'s bucket layout', () => {
    const at = T('2026-10-12T12:00Z');
    assert.equal(modelFileUrl(hrrr, at, 'prs', 7),
        'https://noaa-hrrr-bdp-pds.s3.amazonaws.com/hrrr.20261012/conus/hrrr.t12z.wrfprsf07.grib2');
    assert.equal(modelFileUrl(getDataset('hrrr-subh'), at, 'subh', 6),
        'https://noaa-hrrr-bdp-pds.s3.amazonaws.com/hrrr.20261012/conus/hrrr.t12z.wrfsubhf06.grib2');
    assert.equal(modelFileUrl(getDataset('rrfs'), at, 'surface', 6),
        'https://noaa-rrfs-ops-pds.s3.amazonaws.com/rrfs.20261012/12/rrfs.t12z.2dfld.3km.f006.conus.grib2');
    assert.equal(modelFileUrl(getDataset('rrfs'), at, 'levels', 6),
        'https://noaa-rrfs-ops-pds.s3.amazonaws.com/rrfs.20261012/12/rrfs.t12z.prslev.3km.f006.conus.grib2');
    assert.equal(modelFileUrl(getDataset('rrfs-subh'), at, 'surface', 6),
        'https://noaa-rrfs-ops-pds.s3.amazonaws.com/rrfs.20261012/12/rrfs.t12z.2dfld.3km.subh.f006.conus.grib2');
    assert.equal(modelFileUrl(getDataset('refs'), at, 'prob', 12),
        'https://noaa-rrfs-ops-pds.s3.amazonaws.com/refs.20261012/12/ensprod/refs.t12z.prob.f12.conus.grib2');
});

test('every dataset names a real bucket, and each file URL is absolute', () => {
    for (const id of Object.keys(MODEL_DATASETS)) {
        const dataset = getDataset(id);
        assert.ok(APPROVED_DATA_ORIGINS.includes(new URL(dataset.url('20260102', 6, dataset.files[0], 1)).origin), id);
    }
});

test('HRRR synoptic cycles run 48 steps and the others 18', () => {
    assert.deepEqual([0, 6, 12, 18].map((h) => hrrr.runSteps(h)), [48, 48, 48, 48]);
    assert.deepEqual([1, 5, 13, 23].map((h) => hrrr.runSteps(h)), [18, 18, 18, 18]);
    assert.equal(getDataset('rrfs').runSteps(3), 84);
    assert.equal(getDataset('refs').runSteps(9), 60);
    // The sub-hourly products are published to 18 steps whatever the hourly run's length.
    assert.equal(getDataset('hrrr-subh').runSteps(0), 18);
    assert.equal(getDataset('rrfs-subh').runSteps(0), 18);
});

test('cycles a dataset runs at', () => {
    assert.equal(hrrr.cycleHours.length, 24);
    assert.deepEqual([...getDataset('rrfs').cycleHours], [0, 3, 6, 9, 12, 15, 18, 21]);
    assert.deepEqual([...getDataset('refs').cycleHours], [0, 6, 12, 18]);
});

test('published steps are found by binary search in a handful of probes', async () => {
    const init = T('2026-10-12T12:00Z');
    for (const published of [0, 1, 2, 17, 30, 49]) {
        const { probe, probes } = fakeBucket(new Map([[init, published]]));
        assert.equal(await countPublishedSteps(hrrr, init, probe), published);
        assert.ok(probes.length <= 16, `${published}: ${probes.length} probes`);
    }
    const short = T('2026-10-12T13:00Z');
    const { probe } = fakeBucket(new Map([[short, 19]]));
    assert.equal(await countPublishedSteps(hrrr, short, probe), 19);
});

test('a step counts only once every gating file is out', async () => {
    const init = T('2026-10-12T19:00Z');
    const { probe } = fakeBucket(new Map([[init, 3]]), { prs: new Map() });
    assert.equal(await countPublishedSteps(hrrr, init, probe), 0);
    const lag = fakeBucket(new Map([[init, 3]]), { prs: new Map([[init, 2]]) });
    assert.equal(await countPublishedSteps(hrrr, init, lag.probe), 2);
    const now = T('2026-10-12T19:30Z');
    const older = fakeBucket(new Map([[init, 1], [T('2026-10-12T18:00Z'), 5]]), { prs: new Map([[T('2026-10-12T18:00Z'), 5]]) });
    assert.equal((await findNewestRun(now, older.probe, undefined, hrrr)).initMs, T('2026-10-12T18:00Z'));
});

test('REFS gates on the mean product, which is published before the others', async () => {
    const refs = getDataset('refs');
    const init = T('2026-10-12T12:00Z');
    const lag = fakeBucket(new Map([[init, 5]]), { mean: new Map([[init, 4]]) }, 'refs');
    assert.equal(await countPublishedSteps(refs, init, lag.probe), 4);
});

test('the newest run falls back past cycles that are not out yet', async () => {
    const now = T('2026-10-12T18:50Z');
    const { probe } = fakeBucket(new Map([[T('2026-10-12T17:00Z'), 4], [T('2026-10-12T16:00Z'), 19]]));
    const newestRun = await findNewestRun(now, probe, undefined, hrrr);
    assert.equal(newestRun.initMs, T('2026-10-12T17:00Z'));
    assert.equal(newestRun.published, 4);
    assert.equal(newestRun.maxSteps, 18);
    const runs = await listRecentRuns(newestRun, 3, probe, undefined, hrrr);
    assert.deepEqual(runs.map((r) => [runCycle(r.initMs), r.published]), [[17, 4], [16, 19], [15, 0]]);
    const none = fakeBucket(new Map());
    assert.equal(await findNewestRun(now, none.probe, undefined, hrrr), null);
});

const newest = { initMs: T('2026-10-12T17:00Z'), maxSteps: 18, published: 10 };
const pinned = { initMs: T('2026-10-12T12:00Z'), maxSteps: 48, published: 49 };
const now = T('2026-10-12T18:50Z');
const ctx = (extra = {}) => ({ nowMs: now, newest, selected: newest, forecastOnly: false, ...extra });
const show = (src) => src && `${new Date(src.initMs).toISOString().slice(11, 13)}z f${String(src.minutes / 60).padStart(2, '0')}`;

test('observed frames use the analysis of their hour', () => {
    assert.equal(show(chooseModelStep(T('2026-10-12T15:58Z'), ctx(), hrrr)), '16z f00');
    assert.equal(show(chooseModelStep(T('2026-10-12T17:10Z'), ctx(), hrrr)), '17z f00');
    // A pinned run does not change observed frames.
    assert.equal(show(chooseModelStep(T('2026-10-12T15:58Z'), ctx({ selected: pinned }), hrrr)), '16z f00');
});

test('windowed fields use the previous run\'s f01 for observed frames', () => {
    assert.equal(show(chooseModelStep(T('2026-10-12T16:00Z'), ctx({ forecastOnly: true }), hrrr)), '15z f01');
});

test('observed hours newer than the newest run use its forecast', () => {
    assert.equal(show(chooseModelStep(T('2026-10-12T18:40Z'), ctx(), hrrr)), '17z f02');
});

test('future frames use the selected run, and unpublished hours return null', () => {
    assert.equal(show(chooseModelStep(T('2026-10-12T22:00Z'), ctx(), hrrr)), '17z f05');
    assert.equal(chooseModelStep(T('2026-10-13T03:00Z'), ctx(), hrrr), null); // f10 not published
    assert.equal(chooseModelStep(T('2026-10-13T12:00Z'), ctx(), hrrr), null); // past f18
    assert.equal(show(chooseModelStep(T('2026-10-13T03:00Z'), ctx({ selected: pinned }), hrrr)), '12z f15');
    assert.equal(show(chooseModelStep(T('2026-10-14T12:00Z'), ctx({ selected: pinned }), hrrr)), '12z f48');
    assert.equal(chooseModelStep(T('2026-10-14T13:00Z'), ctx({ selected: pinned }), hrrr), null);
});

test('a dataset with no analysis never resolves to step 0', () => {
    const refs = getDataset('refs');
    const run = { initMs: T('2026-10-12T12:00Z'), maxSteps: 60, published: 13 };
    // REFS publishes from f01, so an observed frame at the cycle hour comes from the first step.
    // REFS has no 11z run, so the fallback lands on the 06z cycle that actually published f01.
    assert.equal(show(chooseModelStep(T('2026-10-12T12:10Z'), { nowMs: now, newest: run, selected: run, forecastOnly: false }, refs)), '06z f01');
    assert.equal(show(chooseModelStep(T('2026-10-12T13:10Z'), { nowMs: now, newest: run, selected: run, forecastOnly: false }, refs)), '12z f01');
    assert.equal(refs.minStep, 1);
    assert.equal(getDataset('rrfs-subh').minStep, 1);
    assert.equal(hrrr.minStep, 0);
});

test('15-minute models snap to the quarter hour and address the file that holds it', () => {
    const sub = getDataset('hrrr-subh');
    const rrfsSub = getDataset('rrfs-subh');
    assert.equal(sub.stepMinutes, 15);
    // HRRR: f06 holds 315/330/345/360 min, so 315 -> file 6.
    assert.equal(stepIndexOf(sub, 315), 6);
    assert.equal(stepIndexOf(sub, 360), 6);
    assert.equal(stepIndexOf(sub, 375), 7);
    assert.equal(stepIndexOf(sub, 0), 0);
    // RRFS: f006 holds only the three interior steps, so 360 falls to file 7 (the hourly file covers it).
    assert.equal(stepIndexOf(rrfsSub, 315), 6);
    assert.equal(stepIndexOf(rrfsSub, 360), 7);
    assert.equal(stepIndexOf(rrfsSub, 0), 0);
});

test('an hourly dataset measures its step index in forecast hours', () => {
    assert.equal(stepIndexOf(hrrr, 60), 1);
    assert.equal(stepIndexOf(hrrr, 720), 12);
    assert.equal(stepIndexOf(getDataset('rrfs'), 360), 6);
});

test('an hour is 3 600 000 ms', () => {
    assert.equal(HOUR_MS, 3_600_000);
});

test('a dataset whose sub-hourly object stops short of the hour snaps back off it', () => {
    const rrfsSub = getDataset('rrfs-subh');
    const hrrrSub = getDataset('hrrr-subh');
    // RRFS's `subh` files carry :15, :30 and :45 but no :00, so an exact hour has no component and
    // must resolve to the preceding quarter-hour rather than fail.
    assert.equal(rrfsSub.hourBoundaryInHourly, true);
    assert.equal(roundStep(T('2026-10-12T20:00Z'), rrfsSub), T('2026-10-12T19:45Z'));
    assert.equal(roundStep(T('2026-10-12T20:07Z'), rrfsSub), T('2026-10-12T19:45Z'));
    assert.equal(roundStep(T('2026-10-12T20:15Z'), rrfsSub), T('2026-10-12T20:15Z'));
    assert.equal(stepIndexOf(rrfsSub, 45), 1, 'and :45 lives in the first sub-hourly file');
    // HRRR's include the hour boundary, so they snap onto it.
    assert.equal(hrrrSub.hourBoundaryInHourly, undefined);
    assert.equal(roundStep(T('2026-10-12T20:00Z'), hrrrSub), T('2026-10-12T20:00Z'));
    assert.equal(stepIndexOf(hrrrSub, 60), 1);
    // Hourly models are unaffected.
    assert.equal(roundStep(T('2026-10-12T20:07Z'), hrrr), T('2026-10-12T20:00Z'));
});
