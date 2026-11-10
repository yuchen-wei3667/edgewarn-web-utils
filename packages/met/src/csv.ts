import { equivalentPotentialTemperature } from './bolton.ts';
import { thetaK, virtualTemperatureC, wetBulbC } from './thermo.ts';
import type { Column, ColumnSeries } from './types.ts';

/**
 * Speed (m/s) and the direction the wind blows FROM, degrees in [0, 360). A calm wind reads 180 here, as the
 * website's CSV has always written it; `windFromComponents` reads 0 for calm.
 */
function speedAndDirection(u: number, v: number): { speed: number; direction: number } {
    return { speed: Math.hypot(u, v), direction: (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360 };
}

/**
 * One column as CSV (phase 5.4 "Export"): every level with the derived arrays, under `#` provenance lines that say where the
 * numbers came from (the provider, model, run, valid time, cell and the files read). SI units throughout; a missing value is empty.
 */

const COLUMNS = ['p_hpa', 'z_m_msl', 'z_m_agl', 't_c', 'td_c', 'tv_c', 'tw_c', 'theta_k', 'theta_e_k', 'u_ms', 'v_ms', 'speed_ms', 'direction_deg'] as const;

const cell = (value: number): string => (Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : '');
const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 16) + 'Z';

/** @public */
export function soundingCsv(series: ColumnSeries, column: Column): string {
    const withW = column.vertical !== undefined;
    const lines = [
        `# Weather data by Open-Meteo.com (CC BY 4.0), a copy of ${series.derivedFrom ?? series.model} model output`,
        `# source: ${series.type}`,
        `# model: ${series.model}`,
        `# run: ${iso(series.initMs)}`,
        `# valid: ${iso(column.validMs)}`,
        `# cell: i=${series.cell.i} j=${series.cell.j} lat=${series.cell.lat.toFixed(4)} lon=${series.cell.lon.toFixed(4)}`,
        `# surface pressure (hPa): ${cell(column.surface.p)} (estimated from the pressure levels' heights and the model terrain)`,
        ...series.notes.map((note) => `# note: ${note}`),
        ...series.provenance.urls.map((url) => `# read: ${url}`),
        [...COLUMNS, ...(withW ? ['w_ms'] : [])].join(','),
    ];
    for (let k = 0; k < column.p.length; k++) {
        const { p, t, td } = { p: column.p[k], t: column.t[k], td: column.td[k] };
        const wind = speedAndDirection(column.u[k], column.v[k]);
        const row = [
            p, column.z[k], column.z[k] - column.z[0], t, td, virtualTemperatureC(p, t, td), wetBulbC(p, t, td), thetaK(p, t),
            Number.isFinite(td) ? equivalentPotentialTemperature(p, t, td) : Number.NaN, column.u[k], column.v[k], wind.speed, wind.direction,
            ...(withW && column.vertical ? [column.vertical.values[k]] : []),
        ];
        lines.push(row.map(cell).join(','));
    }
    return `${lines.join('\n')}\n`;
}
