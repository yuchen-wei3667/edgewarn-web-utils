import assert from 'node:assert/strict';
import test from 'node:test';
import { soundingCsv } from '@edgewarn/web-utils/met';
import { LEVELS, mkCol, unstableColumn } from './helpers.mjs';

/** The export of one column: provenance first, a stable header, one row per level, empty for what is missing. */

const column = () => ({ ...unstableColumn(), validMs: Date.UTC(2026, 9, 29, 21) });
const series = () => ({
    model: 'hrrr', initMs: Date.UTC(2026, 9, 29, 19), cell: { i: 901, j: 407, lat: 35.2201, lon: -97.4398 }, type: 'test-reader',
    columns: [column()], validTimes: [column().validMs], complete: true,
    provenance: { urls: ['https://example.test/a.nc'], bytes: 10 }, notes: ['surface pressure was estimated'],
});

test('the file leads with provenance and credit, then a stable header, then a row per level', () => {
    const col = column();
    const lines = soundingCsv(series(), col).trimEnd().split('\n');
    const header = lines.findIndex((l) => !l.startsWith('#'));
    assert.match(lines[0], /Weather data by Open-Meteo\.com \(CC BY 4\.0\), a copy of hrrr model output/);
    for (const wanted of ['# source: test-reader', '# model: hrrr', '# run: 2026-10-29T19:00Z', '# valid: 2026-10-29T21:00Z', '# note: surface pressure was estimated', '# read: https://example.test/a.nc'])
        assert.ok(lines.includes(wanted), wanted);
    assert.ok(lines.some((l) => l.startsWith('# cell: i=901 j=407 lat=35.2201 lon=-97.4398')));
    assert.equal(lines[header], 'p_hpa,z_m_msl,z_m_agl,t_c,td_c,tv_c,tw_c,theta_k,theta_e_k,u_ms,v_ms,speed_ms,direction_deg');
    assert.equal(lines.length - header - 1, col.p.length);
    const first = lines[header + 1].split(',');
    assert.equal(first.length, 13);
    assert.equal(first[2], '0', 'height above ground is zero at the surface row');
    assert.ok(Math.abs(Number(first[0]) - col.p[0]) < 1e-3);
});

test('a missing value is an empty cell and vertical velocity adds a column only when the column has it', () => {
    const base = column();
    const gap = { ...base, td: Float32Array.from(base.td, (v, k) => (k === 3 ? Number.NaN : v)) };
    const rows = soundingCsv(series(), gap).trimEnd().split('\n').filter((l) => !l.startsWith('#'));
    assert.equal(rows[0].split(',').length, 13);
    assert.equal(rows[4].split(',')[4], '', 'the dewpoint cell');
    assert.equal(rows[4].split(',')[8], '', 'and the theta-e that needs it');
    const withW = { ...base, vertical: { units: 'm/s', values: Float32Array.from(base.p, () => 0.25) } };
    const wRows = soundingCsv(series(), withW).trimEnd().split('\n').filter((l) => !l.startsWith('#'));
    assert.ok(wRows[0].endsWith(',w_ms') && wRows[1].endsWith(',0.25'));
});

test('direction is where the wind blows from, and a calm level keeps the 180 the website always wrote', () => {
    const col = mkCol(LEVELS.slice(0, 3), [20, 18, 16], [10, 8, 6], [0, 0, 5], [0, -5, 0]);
    const rows = soundingCsv({ ...series(), derivedFrom: 'NOAA HRRR' }, col).trimEnd().split('\n');
    assert.match(rows[0], /a copy of NOAA HRRR model output/);
    const data = rows.filter((l) => !l.startsWith('#')).slice(1).map((l) => l.split(','));
    assert.deepEqual(data.map((r) => [r[11], r[12]]), [['0', '180'], ['5', '0'], ['5', '270']]);
});
