/**
 * Kinematics of the sounding science core (phase 5 plan, section 5.4): bulk shear, layer mean winds,
 * Bunkers et al. (2000) storm motion, storm-relative helicity over 250 m sampled hodographs, the
 * effective inflow layer (Thompson et al. 2007) and the critical angle (Esterheld & Giuliano 2008).
 * Ports of SHARPpy `sharppy/sharptab/winds.py`/`params.py`; every value is null when the data cannot
 * define it, and nothing throws (NaN in means null out).
 */

import {
    SOUNDING_EFFECTIVE_SEARCH_DEPTH_HPA,
    SOUNDING_EFFECTIVE_CAPE_JKG,
    SOUNDING_EFFECTIVE_CIN_MAX_JKG,
    SOUNDING_SRH_INTERVAL_M,
    SOUNDING_BUNKERS_DEVIATION_MS,
    SOUNDING_BUNKERS_LOW_M,
    SOUNDING_BUNKERS_UPPER_BASE_M,
    SOUNDING_BUNKERS_UPPER_TOP_M,
} from './constants.ts';
import { fieldAt, pressureAtAgl, heightAglAt, layerMean } from './interp.ts';
import { capeCheckColumn, mostUnstableParcelDef } from './parcels.ts';
import type { Column, LayerBounds, Vec2 } from './types.ts';

const finite = (v: number): boolean => Number.isFinite(v);
/** Wind components at a pressure level, null when either component is missing. */
const componentsAt = (col: Column, pHpa: number): Vec2 | null => {
    if (!finite(pHpa)) return null;
    const u = fieldAt(col, 'u', pHpa);
    const v = fieldAt(col, 'v', pHpa);
    return finite(u) && finite(v) ? { u, v } : null;
};

/* ------------------------------------------------------------------ */
/* Shear and mean winds                                                */
/* ------------------------------------------------------------------ */

/** Bulk shear magnitude (m/s) between the surface row and the wind at `topAglM` metres AGL. */
export function bulkShear(col: Column, topAglM: number): number | null {
    const top = componentsAt(col, pressureAtAgl(col, topAglM));
    if (!top || !finite(col.u[0]) || !finite(col.v[0])) return null;
    return Math.hypot(top.u - col.u[0], top.v - col.v[0]);
}

/** Pressure-weighted or simple mean wind (m/s) over a pressure layer; null when the layer is empty. */
export function meanWind(col: Column, pBotHpa: number, pTopHpa: number, weighted: boolean): Vec2 | null {
    const u = layerMean(col, 'u', pBotHpa, pTopHpa, { weighted });
    const v = layerMean(col, 'v', pBotHpa, pTopHpa, { weighted });
    return finite(u) && finite(v) ? { u, v } : null;
}

export interface BunkersResult {
    right: Vec2 | null;
    left: Vec2 | null;
    /** Non-pressure-weighted 0-6 km mean wind the motions deviate from. */
    mean06: Vec2 | null;
}

/**
 * The right-mover deviation of Bunkers et al. (2000): the mean wind moved D = 7.5 m/s perpendicular to the shear
 * (su, sv), to its right; pass the negated shear for the left mover. Shared with the gridded storm-relative flow.
 */
export function bunkersDeviate(mean: Vec2, su: number, sv: number): Vec2 {
    const mag = Math.hypot(su, sv);
    const k = mag > 0 ? SOUNDING_BUNKERS_DEVIATION_MS / mag : 0;
    return { u: mean.u + k * sv, v: mean.v - k * su };
}

/**
 * Bunkers et al. (2000): the mean is the non-pressure-weighted 0-6 km wind, the shear segments are
 * pressure-weighted means of 0-0.5 km and 5.5-6 km, and both movers deviate by D = 7.5 m/s
 * perpendicular to the segment shear. Null pieces when the column does not reach the layer.
 */
export function bunkersMotion(col: Column): BunkersResult {
    const pBot = col.p[0];
    const p0500 = pressureAtAgl(col, SOUNDING_BUNKERS_LOW_M);
    const p5500 = pressureAtAgl(col, SOUNDING_BUNKERS_UPPER_BASE_M);
    const p6000 = pressureAtAgl(col, SOUNDING_BUNKERS_UPPER_TOP_M);
    const mean06 = meanWind(col, pBot, p6000, false);
    if (!finite(p0500) || !finite(p5500) || !finite(p6000) || !mean06) {
        return { right: null, left: null, mean06 };
    }
    const segLow = meanWind(col, pBot, p0500, true);
    const segUp = meanWind(col, p5500, p6000, true);
    const deviate = bunkersDeviate;
    if (!segLow || !segUp || Math.hypot(segUp.u - segLow.u, segUp.v - segLow.v) === 0) {
        return { right: null, left: null, mean06 };
    }
    const su = segUp.u - segLow.u;
    const sv = segUp.v - segLow.v;
    const right = deviate(mean06, su, sv);
    const left = deviate(mean06, -su, -sv);
    return { right, left, mean06 };
}

/* ------------------------------------------------------------------ */
/* Storm-relative helicity                                             */
/* ------------------------------------------------------------------ */

/**
 * Storm-relative helicity (m²/s²) from `lowerAglM` to `upperAglM` metres AGL, sampled every
 * `SOUNDING_SRH_INTERVAL_M` with the SHARPpy layer form Σ[(u_{n+1} − cx)(v_n − cy) −
 * (u_n − cx)(v_{n+1} − cy)] (positive for a hodograph that veers with height around the storm
 * motion), negative segments included. Null when the layer leaves the data.
 */
export function helicity(col: Column, lowerAglM: number, upperAglM: number, storm: Vec2): number | null {
    if (!(upperAglM > lowerAglM)) return null;
    if (!finite(pressureAtAgl(col, upperAglM))) return null; // a layer leaving the profile is undefined
    const n = Math.max(2, Math.round((upperAglM - lowerAglM) / SOUNDING_SRH_INTERVAL_M) + 1);
    const step = (upperAglM - lowerAglM) / (n - 1);
    let total = 0;
    let used = 0;
    let sruPrev = NaN;
    let srvPrev = NaN;
    for (let k = 0; k < n; k++) {
        const c = componentsAt(col, pressureAtAgl(col, lowerAglM + k * step));
        if (!c) continue; // missing samples drop out like SHARPpy's compressed levels
        const sru = c.u - storm.u;
        const srv = c.v - storm.v;
        if (finite(sruPrev) && finite(srvPrev)) {
            total += sru * srvPrev - sruPrev * srv;
            used++;
        }
        sruPrev = sru;
        srvPrev = srv;
    }
    if (used === 0) return null;
    return total === 0 ? 0 : total; // never -0: a summed-zero hodograph is still 0, not null
}

/* ------------------------------------------------------------------ */
/* Effective inflow layer                                              */
/* ------------------------------------------------------------------ */

/**
 * The lowest contiguous layer whose level parcels have CAPE >= 100 J kg⁻¹ and CIN > −250 J kg⁻¹
 * (Thompson et al. 2007), tested from every level in the lowest 300 hPa and gated by the MU parcel
 * passing the same criteria. Search uses the cheap `capeCheckColumn` lifter. Null when undefined.
 */
export function effectiveInflowLayer(col: Column): LayerBounds | null {
    const muDef = mostUnstableParcelDef(col);
    if (!muDef) return null;
    const mu = capeCheckColumn(col, muDef);
    if (!(mu.cape >= SOUNDING_EFFECTIVE_CAPE_JKG && mu.cin > SOUNDING_EFFECTIVE_CIN_MAX_JKG)) {
        return null; // NaN never qualifies, as in SHARPpy's `mucape != 0` gate
    }
    const searchTop = col.p[0] - SOUNDING_EFFECTIVE_SEARCH_DEPTH_HPA;
    let baseP = NaN;
    let topP: number | null = null;
    for (let i = 0; i < col.p.length && col.p[i] >= searchTop; i++) {
        if (col.t[i] === 0 || col.td[i] === 0 || !finite(col.t[i]) || !finite(col.td[i])) continue;
        const pcl = capeCheckColumn(col, { p: col.p[i], t: col.t[i], td: col.td[i] });
        const qualifies =
            finite(pcl.cape) &&
            finite(pcl.cin) &&
            pcl.cape >= SOUNDING_EFFECTIVE_CAPE_JKG &&
            pcl.cin > SOUNDING_EFFECTIVE_CIN_MAX_JKG;
        if (!finite(baseP)) {
            if (qualifies) baseP = col.p[i];
            continue;
        }
        if (!qualifies) break;
        topP = col.p[i];
    }
    if (!finite(baseP)) return null;
    return { baseP, topP: topP ?? baseP };
}

/**
 * Effective bulk wind difference (m/s, Thompson et al. 2007): shear from the effective base to the
 * level half-way to the MU parcel's EL height AGL.
 */
export function effectiveBulkShear(
    col: Column,
    muElZagl: number | null,
    layer: LayerBounds | null,
): number | null {
    if (!layer || muElZagl === null) return null;
    const baseZ = heightAglAt(col, layer.baseP);
    if (!finite(baseZ)) return null;
    const depth = (muElZagl - baseZ) / 2;
    if (!(depth > 0)) return null;
    const top = componentsAt(col, pressureAtAgl(col, baseZ + depth));
    const bottom = componentsAt(col, layer.baseP);
    if (!top || !bottom) return null;
    return Math.hypot(top.u - bottom.u, top.v - bottom.v);
}

/* ------------------------------------------------------------------ */
/* Critical angle                                                      */
/* ------------------------------------------------------------------ */

/**
 * Critical angle (degrees, Esterheld & Giuliano 2008): the angle between the 0-500 m AGL shear
 * vector and the storm-motion vector relative to the surface wind. 90° marks pure streamwise
 * vorticity in the lowest 500 m.
 */
export function criticalAngle(col: Column, storm: Vec2): number | null {
    const at500 = componentsAt(col, pressureAtAgl(col, 500));
    if (!at500) return null;
    const v1u = at500.u - col.u[0];
    const v1v = at500.v - col.v[0];
    const v2u = storm.u - col.u[0];
    const v2v = storm.v - col.v[0];
    const m1 = Math.hypot(v1u, v1v);
    const m2 = Math.hypot(v2u, v2v);
    if (!(m1 * m2 > 0)) return null;
    const dot = Math.min(1, Math.max(-1, (v1u * v2u + v1v * v2v) / (m1 * m2)));
    return (Math.acos(dot) * 180) / Math.PI;
}
