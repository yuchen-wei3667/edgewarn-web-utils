import { equivalentPotentialTemperature, saturationVapourPressure } from '../bolton.ts';
import type { Column } from '../types.ts';

/**
 * The time-height section as arrays (phase 5.6): one column per valid time, one row per pressure level, ready for a canvas
 * or a contour pass. Pure; nothing here draws. Rows are the union of the levels that are above the ground in any column,
 * highest pressure first, so row `r` is the same pressure in every column; a level under the ground (or missing) in a column
 * is NaN there, which is what the picture masks as terrain.
 */

/** @public */
export interface TimeHeightGrid {
    /** Valid times, ms, ascending: one per column of the grid. */
    times: number[];
    /** Pressure, hPa, descending: one per row. The surface is not a row; `surfaceP` gives it for each column. */
    levels: number[];
    /** Surface pressure of each column, hPa: where the terrain mask starts. */
    surfaceP: Float32Array;
    /** Row-major [row][column]. Relative humidity in percent with respect to water, wrt the temperature and dewpoint of the column. */
    rh: Float32Array;
    /** Equivalent potential temperature, K (Bolton 1980). */
    thetaE: Float32Array;
    u: Float32Array;
    v: Float32Array;
    /** Vertical velocity, m/s, when every column carries it. */
    w?: Float32Array;
}

/** Relative humidity in percent from temperature and dewpoint (both degrees C); NaN when either is missing. */
export const relativeHumidity = (tC: number, tdC: number): number =>
    Number.isFinite(tC) && Number.isFinite(tdC) ? Math.min(100, 100 * saturationVapourPressure(tdC) / saturationVapourPressure(tC)) : Number.NaN;

export function buildTimeHeight(columns: readonly Column[]): TimeHeightGrid {
    const sorted = [...columns].sort((a, b) => a.validMs - b.validMs);
    const levels = [...new Set(sorted.flatMap((c) => Array.from(c.p).slice(1)))].sort((a, b) => b - a);
    const ncol = sorted.length;
    const size = levels.length * ncol;
    const make = () => new Float32Array(size).fill(Number.NaN);
    const grid: TimeHeightGrid = {
        times: sorted.map((c) => c.validMs), levels, surfaceP: Float32Array.from(sorted, (c) => c.p[0]),
        rh: make(), thetaE: make(), u: make(), v: make(),
    };
    const withW = ncol > 0 && sorted.every((c) => c.vertical);
    if (withW) grid.w = make();
    const rowOf = new Map(levels.map((p, r) => [p, r]));
    sorted.forEach((c, col) => {
        // The surface row is element 0; only the levels above it are rows.
        for (let k = 1; k < c.p.length; k++) {
            const at = (rowOf.get(c.p[k]) as number) * ncol + col;
            grid.rh[at] = relativeHumidity(c.t[k], c.td[k]);
            grid.thetaE[at] = Number.isFinite(c.td[k]) ? equivalentPotentialTemperature(c.p[k], c.t[k], c.td[k]) : Number.NaN;
            grid.u[at] = c.u[k];
            grid.v[at] = c.v[k];
            if (grid.w && c.vertical) grid.w[at] = c.vertical.values[k];
        }
    });
    return grid;
}
