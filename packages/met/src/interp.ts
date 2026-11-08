/**
 * Vertical interpolation of the sounding science core (phase 5 plan, section 5.2 `interp`). Pressures
 * interpolate linearly in log-p (SHARPpy's `generic_interp_pres`), heights the other way; layer
 * means follow SHARPpy's sampling and weighting so mixed-layer and effective parcels match its
 * `DefineParcel` behaviour. Every value is NaN when the bracket is missing, never an error.
 */

import type { Column } from './types.ts';
import { SOUNDING_LAYER_STEP_HPA } from './constants.ts';

/** Field keys the interpolation helpers accept on a `Column`. */
export type ColumnField = 'p' | 'z' | 't' | 'td' | 'u' | 'v';

const fieldOf = (col: Column, field: ColumnField): Float32Array =>
    field === 'p'
        ? col.p
        : field === 'z'
          ? col.z
          : field === 't'
            ? col.t
            : field === 'td'
              ? col.td
              : field === 'u'
                ? col.u
                : col.v;

/** Linear interpolation of `field` in log-p. Outside the profile -> NaN. `pxy` arrays are descending. */
export function interpolateLogP(ps: Float32Array, field: Float32Array, pHpa: number): number {
    const n = ps.length;
    if (n === 0 || !Number.isFinite(pHpa) || pHpa <= 0) return NaN;
    const lp = Math.log10(pHpa);
    if (pHpa > ps[0] || pHpa < ps[n - 1]) return NaN;
    if (pHpa === ps[0]) return field[0];
    if (pHpa === ps[n - 1]) return field[n - 1];
    // `ps` is strictly decreasing; find the bracketing pair (index j below, j+1 above).
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (ps[mid] >= pHpa) lo = mid;
        else hi = mid;
    }
    const l0 = Math.log10(ps[lo]);
    const l1 = Math.log10(ps[hi]);
    const w = (lp - l0) / (l1 - l0);
    return field[lo] + w * (field[hi] - field[lo]);
}

/** Height (m MSL) at a pressure (hPa). */
export function heightAt(col: Column, pHpa: number): number {
    return interpolateLogP(col.p, col.z, pHpa);
}

/** Pressure (hPa) at a height (m MSL), interpolating pressure linearly against height. */
export function pressureAt(col: Column, zMsl: number): number {
    const n = col.z.length;
    if (n === 0 || !Number.isFinite(zMsl)) return NaN;
    if (zMsl === col.z[0]) return col.p[0];
    if (zMsl < col.z[0] || zMsl > col.z[n - 1]) return NaN;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (col.z[mid] <= zMsl) lo = mid;
        else hi = mid;
    }
    const w = (zMsl - col.z[lo]) / (col.z[hi] - col.z[lo]);
    return col.p[lo] + w * (col.p[hi] - col.p[lo]);
}

/** Any column field at a pressure (hPa): temperature or moisture with `field`, wind with `u`/`v`. */
export function fieldAt(col: Column, field: ColumnField, pHpa: number): number {
    return interpolateLogP(col.p, fieldOf(col, field), pHpa);
}

/** Heights AGL (m) of the profile: `col.z` minus the surface height. */
export function heightsAgl(col: Column): Float32Array {
    const out = new Float32Array(col.z.length);
    for (let i = 0; i < col.z.length; i++) out[i] = col.z[i] - col.z[0];
    return out;
}

/** Height AGL (m) at a pressure, as SHARPpy `to_agl(hght(p))`. */
export function heightAglAt(col: Column, pHpa: number): number {
    return heightAt(col, pHpa) - col.z[0];
}

/** Pressure (hPa) at a height AGL (m). */
export function pressureAtAgl(col: Column, zAglM: number): number {
    return pressureAt(col, zAglM + col.z[0]);
}

/**
 * The lowest level of the given temperature crossing: temperature exactly on a level returns that
 * level's pressure, otherwise the first bracketing pair (SHARPpy `temp_lvl`). NaN when the value
 * never occurs.
 */
export function levelOfTemperature(col: Column, tC: number): number {
    const n = col.t.length;
    if (!Number.isFinite(tC) || n === 0) return NaN;
    let sign = Math.sign(col.t[0] - tC);
    if (col.t[0] === tC) return col.p[0];
    for (let i = 1; i < n; i++) {
        const s = Math.sign(col.t[i] - tC);
        if (s === 0) return col.p[i];
        if (s !== sign && sign !== 0) {
            const lp =
                Math.log10(col.p[i - 1]) +
                ((tC - col.t[i - 1]) / (col.t[i] - col.t[i - 1])) *
                    (Math.log10(col.p[i]) - Math.log10(col.p[i - 1]));
            return 10 ** lp;
        }
        sign = s;
    }
    return NaN;
}

export interface LayerMeanOptions {
    /** Weight samples by their pressure (SHARPpy interpolated `ma.average(weights=p)`). Default true. */
    weighted?: boolean;
    /** Sampling step in hPa (default `SOUNDING_LAYER_STEP_HPA`, SHARPpy's interpolated `dp = -1`). */
    stepHpa?: number;
}

/**
 * Layer mean of a field between two pressures (`pBotHpa` > `pTopHpa`), sampled from the column on a
 * fixed pressure grid, endpoints included via interpolation. NaN dots are skipped (no throw); an
 * all-missing layer is NaN.
 */
export function layerMean(
    col: Column,
    field: ColumnField,
    pBotHpa: number,
    pTopHpa: number,
    options: LayerMeanOptions = {},
): number {
    const step = options.stepHpa ?? SOUNDING_LAYER_STEP_HPA;
    if (pBotHpa <= pTopHpa || !Number.isFinite(pBotHpa) || !Number.isFinite(pTopHpa)) return NaN;
    const values = fieldOf(col, field);
    const n = Math.max(1, Math.round((pBotHpa - pTopHpa) / step) + 1);
    let sum = 0;
    let weight = 0;
    for (let k = 0; k < n; k++) {
        const p = k === n - 1 ? pTopHpa : pBotHpa - k * step;
        const v = interpolateLogP(col.p, values, p);
        if (!Number.isFinite(v)) continue;
        const w = options.weighted === false ? 1 : p;
        sum += v * w;
        weight += w;
    }
    return weight > 0 ? sum / weight : NaN;
}

/**
 * SHARPpy `mean_theta(exact=True)` / `mean_mixratio(exact=True)` scheme: the interpolated layer
 * endpoints count once and every level in between counts twice. Applied to a per-level value the
 * caller computes; NaN levels are skipped. Undefined (empty layer) -> NaN.
 */
export function exactLayerMean(
    col: Column,
    pBotHpa: number,
    pTopHpa: number,
    valueAtLevel: (i: number) => number,
    endpoint: (pHpa: number) => number,
): number {
    if (pBotHpa <= pTopHpa || !Number.isFinite(pBotHpa) || !Number.isFinite(pTopHpa)) return NaN;
    let sum = endpoint(pBotHpa) + endpoint(pTopHpa);
    let count = 2;
    for (let i = 0; i < col.p.length; i++) {
        if (col.p[i] >= pBotHpa || col.p[i] <= pTopHpa) continue;
        const v = valueAtLevel(i);
        if (!Number.isFinite(v)) continue;
        sum += 2 * v;
        count += 2;
    }
    return count > 0 ? sum / count : NaN;
}

/** Strictly-decreasing duplicated-pressure guard for the mean helpers above. */
export const isLayerValid = (col: Column, pBotHpa: number, pTopHpa: number): boolean =>
    Number.isFinite(pBotHpa) &&
    Number.isFinite(pTopHpa) &&
    pBotHpa > pTopHpa &&
    pBotHpa <= col.p[0] &&
    pTopHpa >= col.p[col.p.length - 1];
