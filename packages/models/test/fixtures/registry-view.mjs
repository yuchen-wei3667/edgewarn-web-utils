// A JSON-serialisable view of the models registry's public API. `registry-golden.json` was taken from
// the website's code before the registry existed; golden.test.mjs holds the live API to it. The golden's
// `geometry` section and the timeline's `dwell` and `hours` need the website's map layer and timeline UI, so they
// are not compared here; the website keeps them. Its `fields`, `order`, `panes`, `paneList` and `legacy` sections are
// stale in the website too (models, panes and fields were added after the snapshot), so the view leaves them out.
import { createHash } from 'node:crypto';
import { getDataset, MODEL_IDS } from '../../dist/datasets.js';
import { modelHasIsobars } from '../../dist/catalog.js';
import { chooseModelStep, roundStep, stepIndexOf } from '../../dist/listing.js';
import { levelLayout } from '../../dist/tiles.js';

/**
 * The models the golden was taken from. A model added later is not in it, and appears nowhere in the view:
 * not as a dataset, not in a field's `models` or search terms, and its own fields are left out. Adding a
 * model therefore never touches the golden.
 */
const ORIGINAL_MODELS = ['hrrr', 'hrrr-subh', 'rrfs', 'rrfs-subh', 'refs'];
const GOLDEN_IDS = MODEL_IDS.filter((id) => ORIGINAL_MODELS.includes(id));

const DATE = '20261012';
const sha = (lines) => createHash('sha256').update(lines.join('\n')).digest('hex');
const T = (s) => Date.parse(s);

/** The HRRR grid the golden geometry was taken on. */
export const GOLDEN_GRID = {
    projection: 'lambert', nx: 1799, ny: 1059, lat1: 21.138123, lon1: 237.280472, lov: 262.5, latin1: 38.5, latin2: 38.5, dx: 3000, dy: 3000, scanMode: 0x40, radiusM: 6371229,
};

export function buildRegistryView() {
    const out = { datasets: {}, isobars: {}, levels: {}, timeline: {} };
    for (const id of GOLDEN_IDS) {
        const d = getDataset(id);
        const urls = [];
        for (const src of ['sfc', 'prs']) {
            for (const product of d.ensembles) {
                for (let cycle = 0; cycle < 24; cycle++) {
                    for (let step = 0; step <= 60; step++) {
                        urls.push(`${src}|${product}|${cycle}|${step}|${d.url(DATE, cycle, d.fileOf(src, product), step)}`);
                    }
                }
            }
        }
        const gate = [];
        for (const f of d.files) for (let cycle = 0; cycle < 24; cycle += 3) for (const step of [0, 1, 6, 17, 48]) gate.push(`${f}|${cycle}|${step}|${d.url(DATE, cycle, f, step)}`);
        out.datasets[id] = {
            id: d.id, label: d.label, shortLabel: d.shortLabel, bucket: d.bucket, files: d.files, cycleHours: d.cycleHours,
            runSteps: Array.from({ length: 24 }, (_, c) => d.runSteps(c)), minStep: d.minStep, stepMinutes: d.stepMinutes,
            forecastUnit: d.forecastUnit, hourBoundaryInHourly: Boolean(d.hourBoundaryInHourly),
            subHourlyStep: Array.from({ length: 81 }, (_, i) => d.subHourlyStep(i * 15)),
            stepIndex: Array.from({ length: 81 }, (_, i) => stepIndexOf(d, i * 15)),
            ensembles: d.ensembles, qualifiers: d.qualifiers, variables: d.variables ?? null,
            // Added with the profiles config (phase 5.2); the rest of this view is untouched.
            profiles: d.capabilities.profiles,
            levels: (d.levels ?? []).map(([a, b]) => [String(a), b]),
            urlCount: urls.length, urlSha: sha(urls), urlSample: urls.filter((_, i) => i % 211 === 0), gateSha: sha(gate), gateSample: gate.slice(0, 6),
            fileOf: ['sfc', 'prs'].flatMap((s) => d.ensembles.map((p) => `${s}|${p}|${d.fileOf(s, p)}`)),
            roundStep: [0, 1, 7, 8, 14, 15, 29, 30, 44, 59, 60, 61, 90].map((m) => roundStep(T('2026-10-12T12:00Z') + m * 60_000, d)),
        };
        const now = T('2026-10-12T13:07Z');
        const published = 12;
        const newest = { initMs: T('2026-10-12T12:00Z'), maxSteps: d.runSteps(12), published };
        const rows = [];
        for (const forecastOnly of [false, true]) {
            for (let m = -240; m <= 20 * 60; m += 37) {
                const s = chooseModelStep(now + m * 60_000, { nowMs: now, newest, selected: newest, forecastOnly }, d);
                rows.push(`${forecastOnly}|${m}|${s ? `${s.initMs}:${s.minutes}` : 'null'}`);
            }
        }
        out.timeline[id] = { choose: rows };
    }

    for (const id of GOLDEN_IDS) out.isobars[id] = modelHasIsobars(id);
    out.levels = levelsOnGoldenGrid();
    return out;
}

/**
 * Tile levels on the HRRR grid, the one the golden was taken on (when the factors were a global 1, 2, 3).
 * The same maths now takes the dataset's factors; they must give the same layouts.
 */
function levelsOnGoldenGrid() {
    const factors = getDataset('hrrr').factors;
    const levels = {};
    for (let level = 0; level < 3; level++) levels[level] = levelLayout(level, GOLDEN_GRID.nx, GOLDEN_GRID.ny, factors);
    return levels;
}
