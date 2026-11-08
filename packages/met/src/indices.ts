/**
 * Fixed-level thermodynamic indices of the sounding science core (phase 5 plan, section 5.4): lapse
 * rates, precipitable water, K / Total Totals / Showalter, freezing and wet-bulb-zero levels and the
 * Bulk Richardson number. lapse rates follow SHARPpy `lapse_rate` (virtual temperatures at the
 * layer endpoints), PW follows `precip_water` (mixing-ratio trapezoids, converted to mm), K and TT
 * are the standard SPC levels. Null when a layer leaves the profile; NaN in means null out.
 */

import {
    SOUNDING_PW_TOP_HPA,
    SOUNDING_PW_MM_PER_UNIT,
    SOUNDING_BRN_LOW_M,
    SOUNDING_BRN_TOP_M,
} from './constants.ts';
import { mixingRatioHpa } from './bolton.ts';
import { interpolateLogP, pressureAtAgl, heightAglAt, layerMean } from './interp.ts';
import { wetBulbC, virtualTemperatureC } from './thermo.ts';
import type { Column } from './types.ts';

/** Standard pressure levels of the K / TT / Showalter family (definition, not calibration). */
const LR_MID_HPA = [850, 700, 500] as const;

const finite = (v: number): boolean => Number.isFinite(v);
/** Environmental virtual temperature (°C) at a pressure, NaN when missing. */
const envTv = (col: Column, pHpa: number): number => {
    const t = interpolateLogP(col.p, col.t, pHpa);
    return !finite(t) ? NaN : virtualTemperatureC(pHpa, t, interpolateLogP(col.p, col.td, pHpa));
};

/* ------------------------------------------------------------------ */
/* Lapse rates                                                         */
/* ------------------------------------------------------------------ */

/** Mean lapse rate (°C km⁻¹) between two pressures (hPa), virtual temperatures at the endpoints. */
export function lapseRatePressure(col: Column, pBotHpa: number, pTopHpa: number): number | null {
    const z1 = heightAglAt(col, pBotHpa);
    const z2 = heightAglAt(col, pTopHpa);
    const tv1 = envTv(col, pBotHpa);
    const tv2 = envTv(col, pTopHpa);
    if (!finite(z1) || !finite(z2) || !finite(tv1) || !finite(tv2) || !(z2 - z1 > 0)) return null;
    return ((tv2 - tv1) / (z2 - z1)) * -1000;
}

/** Mean lapse rate (°C km⁻¹) between two heights AGL (m), virtual temperatures at the endpoints. */
export function lapseRateHeight(col: Column, lowerAglM: number, upperAglM: number): number | null {
    return lapseRatePressure(col, pressureAtAgl(col, lowerAglM), pressureAtAgl(col, upperAglM));
}

/* ------------------------------------------------------------------ */
/* Precipitable water                                                  */
/* ------------------------------------------------------------------ */

/**
 * Precipitable water (mm) from the surface to `SOUNDING_PW_TOP_HPA` (or the top of data), the
 * mixing-ratio trapezoid of SHARPpy `precip_water` at 1 hPa; mixing ratio itself uses the Bolton
 * dewpoint. Strips with missing moisture are skipped.
 */
export function precipitableWater(col: Column): number | null {
    const n = col.p.length;
    if (n < 2) return null;
    const pTop = Math.max(SOUNDING_PW_TOP_HPA, col.p[n - 1]);
    if (!(pTop < col.p[0])) return null;
    let total = 0;
    let used = 0;
    let wPrev = NaN;
    let pPrev = NaN;
    const nSteps = Math.max(1, Math.round(col.p[0] - pTop) + 1);
    for (let k = 0; k < nSteps; k++) {
        const p = k === nSteps - 1 ? pTop : col.p[0] - k;
        const td = interpolateLogP(col.p, col.td, p);
        const w = mixingRatioHpa(p, td);
        if (!finite(w)) {
            wPrev = NaN;
            pPrev = NaN; // a gap in moisture splits the column
            continue;
        }
        if (finite(wPrev) && finite(pPrev)) {
            total += ((wPrev + w) / 2) * (pPrev - p);
            used++;
        }
        wPrev = w;
        pPrev = p;
    }
    return used > 0 ? total * SOUNDING_PW_MM_PER_UNIT : null;
}

/* ------------------------------------------------------------------ */
/* Fixed-level index family                                            */
/* ------------------------------------------------------------------ */

/** K index (Galway 1956): T850 − T500 + Td850 − (T700 − Td700). */
export function kIndex(col: Column): number | null {
    const t850 = interpolateLogP(col.p, col.t, LR_MID_HPA[0]);
    const t700 = interpolateLogP(col.p, col.t, LR_MID_HPA[1]);
    const t500 = interpolateLogP(col.p, col.t, LR_MID_HPA[2]);
    const td850 = interpolateLogP(col.p, col.td, LR_MID_HPA[0]);
    const td700 = interpolateLogP(col.p, col.td, LR_MID_HPA[1]);
    if (!finite(t850) || !finite(t700) || !finite(t500) || !finite(td850) || !finite(td700)) return null;
    return t850 - t500 + td850 - (t700 - td700);
}

/** Total Totals index (George 1960): (T850 − T500) + (Td850 − T500). */
export function totalTotals(col: Column): number | null {
    const t850 = interpolateLogP(col.p, col.t, LR_MID_HPA[0]);
    const t500 = interpolateLogP(col.p, col.t, LR_MID_HPA[2]);
    const td850 = interpolateLogP(col.p, col.td, LR_MID_HPA[0]);
    if (!finite(t850) || !finite(t500) || !finite(td850)) return null;
    return t850 + td850 - 2 * t500;
}

/**
 * Showalter index: the 500 hPa lifted index of the parcel interpolated to exactly 850 hPa. Null
 * when 850 hPa is above the data or the moist trace does not reach 500 hPa.
 */
export function showalter(col: Column, lift: LiftFn): number | null {
    const t850 = interpolateLogP(col.p, col.t, LR_MID_HPA[0]);
    const td850 = interpolateLogP(col.p, col.td, LR_MID_HPA[0]);
    if (!finite(t850) || !finite(td850)) return null;
    return lift(col, { p: LR_MID_HPA[0], t: t850, td: td850 });
}

/** A parcel lift callable, handed in by `analyze` to avoid a parcels→indices dependency cycle. */
export type LiftFn = (col: Column, def: { p: number; t: number; td: number }) => number | null;

/** Pressure of the first level whose value crosses `value` (SHARPpy `temp_lvl`). */
function firstCrossing(col: Column, values: Float32Array, value: number): number {
    let prev = NaN;
    let prevI = -1;
    for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (!finite(v)) continue;
        if (v === value) return col.p[i];
        if (finite(prev) && prev < value !== v < value) {
            const w = (value - prev) / (v - prev);
            const lp = Math.log10(col.p[prevI]) + w * (Math.log10(col.p[i]) - Math.log10(col.p[prevI]));
            return 10 ** lp;
        }
        prev = v;
        prevI = i;
    }
    return NaN;
}

/** Height AGL (m) of the first plain-temperature 0 °C level. */
export function freezingLevelAgl(col: Column): number | null {
    const p = firstCrossing(col, col.t, 0);
    if (!finite(p)) return null;
    const z = heightAglAt(col, p);
    return finite(z) ? z : null;
}

/** Height AGL (m) of the first wet-bulb 0 °C level (per-level SHARPpy `wetbulb`). */
export function wetBulbZeroAgl(col: Column): number | null {
    const wb = new Float32Array(col.p.length);
    for (let i = 0; i < col.p.length; i++) {
        wb[i] = finite(col.t[i]) && finite(col.td[i]) ? wetBulbC(col.p[i], col.t[i], col.td[i]) : NaN;
    }
    const p = firstCrossing(col, wb, 0);
    if (!finite(p)) return null;
    const z = heightAglAt(col, p);
    return finite(z) ? z : null;
}

/* ------------------------------------------------------------------ */
/* Bulk Richardson number                                              */
/* ------------------------------------------------------------------ */

/**
 * Bulk Richardson number of a parcel with CAPE `capeJkg` (null passes through), SHARPpy
 * `bulk_rich`: shear term ½|V_6km − V_500m|² from pressure-weighted mean winds over 0-500 m and
 * 0-6 km AGL. Null when the winds or the CAPE are undefined or the shear vanishes.
 */
export function bulkRichardson(col: Column, capeJkg: number | null): number | null {
    if (capeJkg === null || !finite(capeJkg)) return null;
    const p500 = pressureAtAgl(col, SOUNDING_BRN_LOW_M);
    const p6km = pressureAtAgl(col, SOUNDING_BRN_TOP_M);
    const low = { u: layerMean(col, 'u', col.p[0], p500), v: layerMean(col, 'v', col.p[0], p500) };
    const deep = { u: layerMean(col, 'u', col.p[0], p6km), v: layerMean(col, 'v', col.p[0], p6km) };
    if (!finite(low.u) || !finite(low.v) || !finite(deep.u) || !finite(deep.v)) return null;
    const shear = Math.hypot(deep.u - low.u, deep.v - low.v);
    if (!(shear > 0)) return null;
    return capeJkg / ((shear * shear) / 2);
}
