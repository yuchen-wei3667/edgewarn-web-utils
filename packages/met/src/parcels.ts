/**
 * Parcel machinery of the sounding science core (phase 5 plan, section 5.4), following SHARPpy
 * `parcelx`/`cape` (Blumberg et al. 2017) with the virtual-temperature correction (Doswell &
 * Rasmussen 1994). Conventions (ADR-P5-4):
 * - CAPE integrates the positive area above the lowest (first) LFC up to the highest (last) EL.
 * - CIN integrates every negative strip below the 500 hPa cut-off, unsaturated layer included.
 * - A parcel with no LFC reports `cape: null`, never 0; missing input makes the parcel null.
 * - Tablets/lifters never throw: NaN in means missing out.
 *
 * Parcel definitions (SPC): surface based; mixed layer over the lowest 100 hPa (SHARPpy
 * `DefineParcel(flag=4)` exact scheme); most unstable as the highest theta-e of the lowest 300 hPa
 * (the SPC 300 hPa convention; SHARPpy's library default scans 400 hPa); effective-layer mean
 * parcel of the effective inflow layer centred at its mid-pressure (`flag=6`, pressure-weighted).
 */

import {
    SOUNDING_GRAVITY,
    SOUNDING_ML_DEPTH_HPA,
    SOUNDING_MU_DEPTH_HPA,
    SOUNDING_CIN_LIMIT_HPA,
    SOUNDING_STRIP_HPA,
    SOUNDING_SEARCH_STRIP_HPA,
    SOUNDING_LAYER_STEP_HPA,
    SOUNDING_CAPE_DEPTH_M,
    SOUNDING_DCAPE_SEARCH_DEPTH_HPA,
    SOUNDING_DCAPE_LAYER_HPA,
    SOUNDING_KELVIN_OFFSET,
} from './constants.ts';
import { equivalentPotentialTemperature, mixingRatioHpa } from './bolton.ts';
import {
    dryLift,
    wetLiftC,
    wetBulbC,
    thetaC,
    temperatureFromThetaC,
    virtualTemperatureC,
    tempAtMixratioC,
} from './thermo.ts';
import { interpolateLogP, heightAglAt, exactLayerMean } from './interp.ts';
import type { Column } from './types.ts';

/** Where a parcel is launched from: pressure hPa, temperature and dewpoint °C at that level. */
export interface ParcelDefinition {
    p: number;
    t: number;
    td: number;
}

/** Buoyancy integrator gravity used by SHARPpy `dcape` (kept for parity, unlike `GRAVITY`). */
const DCAPE_GRAVITY = 9.8;

const missing = (v: number): boolean => !Number.isFinite(v);

/** Closure giving the environmental virtual temperature (°C) at any pressure. */
const envTvOf =
    (col: Column) =>
    (pHpa: number): number => {
        const t = interpolateLogP(col.p, col.t, pHpa);
        const td = interpolateLogP(col.p, col.td, pHpa);
        return missing(t) ? NaN : virtualTemperatureC(pHpa, t, td);
    };

/* ------------------------------------------------------------------ */
/* Parcel definitions                                                  */
/* ------------------------------------------------------------------ */

/** Surface parcel (`flag=1`). */
export function surfaceParcelDef(col: Column): ParcelDefinition {
    return { p: col.p[0], t: col.t[0], td: col.td[0] };
}

/** ML parcel (SHARPpy `DefineParcel(flag=4)`, exact=True): mean theta and mean mixing ratio over
 * the depth, lifted from the layer base temperature/pressure/moisture of the mixed air. */
export function meanLayerParcelDef(col: Column, depthHpa = SOUNDING_ML_DEPTH_HPA): ParcelDefinition | null {
    const pBot = col.p[0];
    const pTop = pBot - depthHpa;
    const thetaOf = (pHpa: number): number => thetaC(pHpa, interpolateLogP(col.p, col.t, pHpa));
    const meanTheta = exactLayerMean(col, pBot, pTop, (i) => thetaC(col.p[i], col.t[i]), thetaOf);
    // Mean mixing ratio of the mixed air: pressure and dewpoint averaged first (SHARPpy
    // mean_mixratio), then the mixing ratio of the averaged air.
    const tdOf = (pHpa: number): number => interpolateLogP(col.p, col.td, pHpa);
    let pSum = pBot + pTop;
    let tdSum = tdOf(pBot) + tdOf(pTop);
    let count = 2;
    for (let i = 0; i < col.p.length; i++) {
        if (col.p[i] >= pBot || col.p[i] <= pTop || missing(col.td[i])) continue;
        pSum += 2 * col.p[i];
        tdSum += 2 * col.td[i];
        count += 2;
    }
    if (missing(meanTheta) || pSum <= 0) return null;
    const tC = temperatureFromThetaC(meanTheta, pBot);
    const tdC = tempAtMixratioC(mixingRatioHpa(pSum / count, tdSum / count), pBot);
    if (missing(tC) || missing(tdC)) return null;
    return { p: pBot, t: tC, td: tdC };
}

/** MU parcel: the highest theta-e level (Bolton) in the lowest `depthHpa` hPa; NaN levels skipped. */
export function mostUnstableParcelDef(
    col: Column,
    depthHpa = SOUNDING_MU_DEPTH_HPA,
): ParcelDefinition | null {
    const bottom = col.p[0] - depthHpa;
    let best = NaN;
    let bestI = -1;
    for (let i = 0; i < col.p.length; i++) {
        if (col.p[i] < bottom) break;
        if (missing(col.t[i]) || missing(col.td[i])) continue;
        const theta = equivalentPotentialTemperature(col.p[i], col.t[i], col.td[i]);
        if (!Number.isFinite(theta) || !Number.isFinite(best) || theta > best) {
            best = theta;
            bestI = i;
        }
    }
    if (bestI < 0) return null;
    return { p: col.p[bestI], t: col.t[bestI], td: col.td[bestI] };
}

/** Effective-layer mean parcel (SHARPpy `DefineParcel(flag=6)`): pressure-weighted 1-hPa layer means
 * on both temperature (as theta) and mixing ratio, lifted from the layer's mid-pressure. */
export function effectiveParcelDef(col: Column, pBotHpa: number, pTopHpa: number): ParcelDefinition | null {
    if (missing(pBotHpa) || missing(pTopHpa) || pBotHpa <= pTopHpa) return null;
    const pMid = (pBotHpa + pTopHpa) / 2;
    const step = SOUNDING_LAYER_STEP_HPA;
    const n = Math.max(1, Math.round((pBotHpa - pTopHpa) / step) + 1);
    let thetaSum = 0;
    let ratioSum = 0;
    let weight = 0;
    for (let k = 0; k < n; k++) {
        const p = k === n - 1 ? pTopHpa : pBotHpa - k * step;
        const t = interpolateLogP(col.p, col.t, p);
        const td = interpolateLogP(col.p, col.td, p);
        const theta = missing(t) ? NaN : thetaC(p, t);
        const ratio = missing(t) || missing(td) || p <= 0 ? NaN : mixingRatioHpa(p, td);
        if (Number.isFinite(theta)) {
            thetaSum += theta * p;
            weight += p;
        }
        if (Number.isFinite(ratio)) ratioSum += ratio * p;
    }
    if (weight <= 0) return null;
    const tC = temperatureFromThetaC(thetaSum / weight, pMid);
    const tdC = tempAtMixratioC(ratioSum / weight, pMid);
    if (missing(tC) || missing(tdC)) return null;
    return { p: pMid, t: tC, td: tdC };
}

/* ------------------------------------------------------------------ */
/* Integration grid                                                    */
/* ------------------------------------------------------------------ */

/**
 * Descending integration pressures from `pHpaBase` down to at most `pHpaTop` (the column top bounds
 * it): uniform strips no wider than `mesh` hPa plus every sounding level in between, deduped.
 */
function integrationGrid(col: Column, pHpaBase: number, pHpaTop: number, mesh: number): Float32Array {
    const bottomLimit = Math.max(pHpaTop, col.p[col.p.length - 1]);
    if (pHpaBase <= bottomLimit) return Float32Array.of();
    const out: number[] = [];
    for (let p = pHpaBase; p > bottomLimit; p -= mesh) out.push(p);
    out.push(bottomLimit);
    for (let i = 0; i < col.p.length; i++) {
        if (col.p[i] < pHpaBase && col.p[i] > bottomLimit) out.push(col.p[i]);
    }
    out.sort((a, b) => b - a);
    const cleaned: number[] = [];
    for (const p of out) {
        if (cleaned.length === 0 || cleaned[cleaned.length - 1] - p > 1e-4) cleaned.push(p);
    }
    return Float32Array.from(cleaned);
}

/** Parcel pressures/heights/temperatures walking the moist adiabat over a grid. */
function moistTrace(
    col: Column,
    grid: Float32Array,
    lclP: number,
    lclT: number,
): { tp: Float64Array; ok: boolean } {
    const n = grid.length;
    const tp = new Float64Array(n).fill(NaN);
    let tPrev = wetLiftC(lclP, lclT, grid[0]);
    if (missing(tPrev)) return { tp, ok: false };
    let ok = true;
    for (let i = 0; i < n; i++) {
        if (i > 0) tPrev = wetLiftC(grid[i - 1], tPrev, grid[i]);
        if (missing(tPrev)) {
            ok = false;
            break;
        }
        tp[i] = tPrev;
    }
    return { tp, ok };
}

/* ------------------------------------------------------------------ */
/* CAPE engine                                                         */
/* ------------------------------------------------------------------ */

export interface LiftResult {
    cape: number | null; // null when the parcel never crosses into buoyancy (no LFC)
    cin: number;
    lclP: number;
    lclZagl: number;
    lfcP: number | null;
    lfcZagl: number | null;
    elP: number | null;
    elZagl: number | null;
    li: number | null; // 500 hPa lifted index in plain temperatures (plan 5.4)
    cape03: number | null;
    trace: { p: number; tv: number }[];
}

/**
 * Full lift of one parcel: SHARPpy `parcelx`-equivalent with the plan's LFC/EL conventions. The
 * integration strips are at most `mesh` hPa wide and include every sounding level, the parcel trace
 * covers the surface (dry part first) to the column top. Returns null only on missing input or an
 * LCL above the data.
 */
export function liftColumn(col: Column, def: ParcelDefinition, mesh = SOUNDING_STRIP_HPA): LiftResult | null {
    if (!col.p || col.p.length < 2) return null;
    if (missing(def.p) || missing(def.t) || missing(def.td) || def.p <= 0) return null;
    if (def.p > col.p[0] + 1e-6) return null; // parcels start at their own level, at or above the surface

    const lcl = dryLift(def.p, def.t, def.td);
    if (missing(lcl.p) || missing(lcl.t) || lcl.p <= 0) return null;
    if (lcl.p < col.p[col.p.length - 1]) return null; // LCL above the data
    // SHARPpy `parcelx`: `if pbot > pres, pbot = pres` - the parcel starts at its own level, and its
    // unsaturated layer runs from there up to the LCL (clamped to the surface, `min(pe2, sfc)`).
    const pStart = def.p;
    const lclP = Math.min(lcl.p, col.p[0]);
    const lclZagl = heightAglAt(col, lclP);
    if (!Number.isFinite(lclZagl)) return null;
    const thetaParcelC = thetaC(lclP, lcl.t);
    const envTv = envTvOf(col);

    /* -- Unsaturated layer below the LCL: constant theta (the LCL theta) and the parcel's own
       mixing ratio (SHARPpy mixing-layer pass, 1 hPa strips). Feeds CIN and the trace. -- */
    const cinStrips: number[] = [];
    const trace: { p: number; tv: number }[] = [];
    const rLpl = mixingRatioHpa(def.p, def.td);
    if (pStart > lclP + 1e-6) {
        const n = Math.max(1, Math.round((pStart - lclP) / SOUNDING_LAYER_STEP_HPA) + 1);
        let zPrev = NaN;
        let tdefPrev = NaN;
        for (let k = 0; k < n; k++) {
            const p = k === n - 1 ? lclP : pStart - k * SOUNDING_LAYER_STEP_HPA;
            const tvPar = virtualTemperatureC(
                p,
                temperatureFromThetaC(thetaParcelC, p),
                tempAtMixratioC(rLpl, p),
            );
            const z = interpolateLogP(col.p, col.z, p);
            if (!Number.isFinite(tvPar) || missing(z)) break;
            const tvEnv = envTv(p);
            const tdef = missing(tvEnv) ? NaN : (tvPar - tvEnv) / (tvEnv + SOUNDING_KELVIN_OFFSET);
            if (Number.isFinite(tdef) && Number.isFinite(tdefPrev) && Number.isFinite(zPrev)) {
                const lyre = ((SOUNDING_GRAVITY * (tdefPrev + tdef)) / 2) * (z - zPrev);
                if (lyre < 0) cinStrips.push(lyre); // SHARPpy sums this layer without the 500 hPa cap
            }
            trace.push({ p, tv: tvPar });
            zPrev = z;
            tdefPrev = tdef;
        }
    }

    /* -- Saturated ascent from the LCL to the column top. -- */
    const grid = integrationGrid(col, lclP, col.p[col.p.length - 1], mesh);
    const nGrid = grid.length;
    if (nGrid < 2) return null;
    const { tp, ok } = moistTrace(col, grid, lclP, lcl.t);

    const tdef = new Float64Array(nGrid);
    for (let i = 0; i < nGrid; i++) {
        const te = envTv(grid[i]);
        tdef[i] =
            missing(te) || missing(tp[i])
                ? NaN
                : (virtualTemperatureC(grid[i], tp[i], tp[i]) - te) / (te + SOUNDING_KELVIN_OFFSET);
    }
    if (ok) {
        for (let i = 0; i < nGrid; i++) {
            if (!missing(tp[i]) && (trace.length === 0 || trace[trace.length - 1].p - grid[i] > 1e-4)) {
                trace.push({ p: grid[i], tv: virtualTemperatureC(grid[i], tp[i], tp[i]) });
            }
        }
    }

    // Heights AGL at every grid point, needed by CAPE, cape03 and CIN.
    const zg = new Float64Array(nGrid);
    for (let i = 0; i < nGrid; i++) zg[i] = interpolateLogP(col.p, col.z, grid[i]);

    // -- LFC: the lowest grid point above the LCL where the parcel is buoyant and stays buoyant one
    //    strip further (SHARPpy demonstrates the crossing before accepting it). Positive at the LCL
    //    itself means LFC == LCL, as SHARPpy forces.
    let lfcIdx = -1;
    if (nGrid > 1 && tdef[0] > 0 && tdef[1] > 0) lfcIdx = 0;
    else
        for (let i = 1; i < nGrid - 1; i++) {
            if (tdef[i] > 0 && tdef[i + 1] > 0) {
                lfcIdx = i;
                break;
            }
        }
    // -- EL: the highest crossing above the LFC (SHARPpy keeps the last one), so no break: the loop
    //    runs to the top and the surviving index is the final positive-to-negative return.
    let elIdx = -1;
    if (lfcIdx >= 0) {
        for (let i = lfcIdx + 1; i < nGrid - 1; i++) {
            if (tdef[i] > 0 && (tdef[i + 1] <= 0 || missing(tdef[i + 1]))) elIdx = i;
        }
    }

    // -- CAPE from the LFC to the highest EL; `cape03` stops at 3000 m AGL.
    let cape = 0;
    let cape03 = 0;
    if (lfcIdx >= 0) {
        const pEl = elIdx >= 0 ? grid[elIdx] : -Infinity;
        for (let i = lfcIdx; i < nGrid - 1; i++) {
            if (grid[i] < pEl) continue; // above the highest EL
            const y = lyreAt(tdef, zg, i);
            if (!Number.isFinite(y) || y <= 0) continue;
            cape += y;
            if ((zg[i] + zg[i + 1]) / 2 - col.z[0] <= SOUNDING_CAPE_DEPTH_M) cape03 += y;
        }
    }
    // -- CIN: every negative strip below the cut-off, unsaturated strips included.
    let cin = 0;
    for (let i = 0; i < nGrid - 1; i++) {
        const y = lyreAt(tdef, zg, i);
        if (!Number.isFinite(y) || y >= 0) continue;
        if ((grid[i] + grid[i + 1]) / 2 <= SOUNDING_CIN_LIMIT_HPA) continue;
        cin += y;
    }
    for (const y of cinStrips) cin += y;

    // -- lifted index at 500 hPa, plain temperatures, when the moist trace reaches the level.
    let li: number | null = null;
    if (ok) {
        const tEnv500 = interpolateLogP(col.p, col.t, 500);
        const tPar500 = traceValueAt(grid, tp, 500);
        if (Number.isFinite(tEnv500) && Number.isFinite(tPar500)) li = tEnv500 - tPar500;
    }

    const topAgl = col.z[col.z.length - 1] - col.z[0];
    const lfcZagl = lfcIdx >= 0 ? heightAglAt(col, grid[lfcIdx]) : NaN;
    const elZagl = elIdx >= 0 ? heightAglAt(col, grid[elIdx]) : NaN;
    return {
        cape: lfcIdx >= 0 ? Math.max(cape, 0) : null,
        cin: Math.min(cin, 0),
        lclP,
        lclZagl,
        lfcP: lfcIdx >= 0 ? grid[lfcIdx] : null,
        lfcZagl: Number.isFinite(lfcZagl) ? lfcZagl : null,
        elP: elIdx >= 0 ? grid[elIdx] : null,
        elZagl: Number.isFinite(elZagl) ? elZagl : null,
        li,
        cape03: lfcIdx >= 0 && topAgl >= SOUNDING_CAPE_DEPTH_M ? Math.max(cape03, 0) : null,
        trace,
    };
}

/** Buoyancy work of strip `i` (between grid points i and i+1): J/kg, NaN when anything is missing. */
function lyreAt(tdef: Float64Array, heights: Float64Array, i: number): number {
    if (missing(tdef[i]) || missing(tdef[i + 1]) || missing(heights[i]) || missing(heights[i + 1]))
        return NaN;
    return ((SOUNDING_GRAVITY * (tdef[i] + tdef[i + 1])) / 2) * (heights[i + 1] - heights[i]);
}

/** Linear (log-p) value of a parcel trace at a pressure inside the grid. */
function traceValueAt(grid: Float32Array, values: Float64Array, pHpa: number): number {
    for (let i = 0; i < grid.length - 1; i++) {
        if (grid[i] >= pHpa && grid[i + 1] <= pHpa) {
            const w =
                (Math.log10(pHpa) - Math.log10(grid[i])) / (Math.log10(grid[i + 1]) - Math.log10(grid[i]));
            return values[i] + w * (values[i + 1] - values[i]);
        }
    }
    return NaN;
}

/* ------------------------------------------------------------------ */
/* Cheap CAPE for the iterative layer searches                         */
/* ------------------------------------------------------------------ */

export interface CapeCheck {
    cape: number;
    cin: number;
} // NaN in both fields when undefined

/**
 * SHARPpy `cape()` equivalent for searches: every positive strip counts towards CAPE, the negative
 * ones below the cut-off towards CIN, on a coarse `mesh` grid, without LFC/EL bookkeeping. Undefined
 * parcels give NaN in both fields.
 */
export function capeCheckColumn(
    col: Column,
    def: ParcelDefinition,
    mesh = SOUNDING_SEARCH_STRIP_HPA,
): CapeCheck {
    const fail = () => ({ cape: NaN, cin: NaN });
    if (!col.p || col.p.length < 2) return fail();
    if (missing(def.p) || missing(def.t) || missing(def.td) || def.p <= 0 || def.p > col.p[0] + 1e-6)
        return fail();
    const lcl = dryLift(def.p, def.t, def.td);
    if (missing(lcl.p) || missing(lcl.t) || lcl.p <= 0 || lcl.p < col.p[col.p.length - 1]) return fail();
    const envTv = envTvOf(col);
    const thetaParcelC = thetaC(lcl.p, lcl.t);
    const rLpl = mixingRatioHpa(def.p, def.td);

    let cape = 0;
    let cin = 0;
    let zPrev = NaN;
    let tdefPrev = NaN;
    // Dry part, 1 hPa strips, as SHARPpy's mixing-layer pass (no 500 hPa cap here).
    if (def.p > lcl.p + 1e-6) {
        const n = Math.max(1, Math.round((def.p - lcl.p) / SOUNDING_LAYER_STEP_HPA) + 1);
        for (let k = 0; k < n; k++) {
            const p = k === n - 1 ? lcl.p : def.p - k * SOUNDING_LAYER_STEP_HPA;
            const tvPar = virtualTemperatureC(
                p,
                temperatureFromThetaC(thetaParcelC, p),
                tempAtMixratioC(rLpl, p),
            );
            const z = interpolateLogP(col.p, col.z, p);
            const tvEnv = envTv(p);
            if (!Number.isFinite(tvPar) || missing(z) || missing(tvEnv)) break;
            const tdef = (tvPar - tvEnv) / (tvEnv + SOUNDING_KELVIN_OFFSET);
            if (Number.isFinite(tdefPrev) && Number.isFinite(zPrev)) {
                const lyre = ((SOUNDING_GRAVITY * (tdefPrev + tdef)) / 2) * (z - zPrev);
                if (lyre < 0) cin += lyre;
            }
            zPrev = z;
            tdefPrev = tdef;
        }
    }
    // Moist part on the coarse grid.
    const grid = integrationGrid(col, lcl.p, col.p[col.p.length - 1], mesh);
    const n = grid.length;
    if (n < 2) return fail();
    const { tp, ok } = moistTrace(col, grid, lcl.p, lcl.t);
    if (!ok) return fail();
    const heights = new Float64Array(n);
    for (let i = 0; i < n; i++) heights[i] = interpolateLogP(col.p, col.z, grid[i]);
    for (let i = 1; i < n; i++) {
        const tePrev = envTv(grid[i - 1]);
        const te = envTv(grid[i]);
        if (missing(tePrev) || missing(te)) continue;
        const tdefPrev =
            (virtualTemperatureC(grid[i - 1], tp[i - 1], tp[i - 1]) - tePrev) /
            (tePrev + SOUNDING_KELVIN_OFFSET);
        const tdef = (virtualTemperatureC(grid[i], tp[i], tp[i]) - te) / (te + SOUNDING_KELVIN_OFFSET);
        const y = ((SOUNDING_GRAVITY * (tdefPrev + tdef)) / 2) * (heights[i] - heights[i - 1]);
        if (!Number.isFinite(y)) continue;
        if (y > 0) cape += y;
        else if ((grid[i] + grid[i - 1]) / 2 > SOUNDING_CIN_LIMIT_HPA) cin += y;
    }
    return { cape, cin };
}

/* ------------------------------------------------------------------ */
/* DCAPE                                                               */
/* ------------------------------------------------------------------ */

/** Pressure-weighted mean theta-e (Bolton) of a layer, SHARPpy `mean_thetae` interpolated scheme. */
function meanThetaeLayer(col: Column, pBotHpa: number, pTopHpa: number): number {
    const step = SOUNDING_LAYER_STEP_HPA;
    const n = Math.max(1, Math.round((pBotHpa - pTopHpa) / step) + 1);
    let sum = 0;
    let weight = 0;
    for (let k = 0; k < n; k++) {
        const p = k === n - 1 ? pTopHpa : pBotHpa - k * step;
        const t = interpolateLogP(col.p, col.t, p);
        const td = interpolateLogP(col.p, col.td, p);
        if (!Number.isFinite(t) || !Number.isFinite(td)) continue;
        const thetae = equivalentPotentialTemperature(p, t, td);
        if (!Number.isFinite(thetae)) continue;
        sum += thetae * p;
        weight += p;
    }
    return weight > 0 ? sum / weight : NaN;
}

/**
 * SHARPpy `dcape`: within the lowest 400 hPa, the 100 hPa layer with the lowest mean theta-e (Bolton)
 * defines the downdraft source (layer mid-pressure); the parcel starts at that level's wet-bulb
 * temperature and descends to the surface wet adiabatically. Plain temperatures and SHARPpy's
 * historical 9.8 gravity factor; only negative-buoyancy strips (parcel colder than its environment)
 * accumulate, reported positive as J/kg. Null when the moisture to define it is missing.
 */
export function dcapeColumn(col: Column): number | null {
    if (!col.p || col.p.length < 2) return null;
    const bottomLimit = col.p[0] - SOUNDING_DCAPE_SEARCH_DEPTH_HPA;
    const topData = col.p[col.p.length - 1];
    // Minimum mean theta-e of a SOUNDING_DCAPE_LAYER_HPA layer whose base sits in the lowest band.
    let best = Infinity;
    let pSource = NaN;
    for (let i = 0; i < col.p.length && col.p[i] >= bottomLimit; i++) {
        const pLayerTop = col.p[i] - SOUNDING_DCAPE_LAYER_HPA;
        if (pLayerTop < topData) continue;
        const mean = meanThetaeLayer(col, col.p[i], pLayerTop);
        if (Number.isFinite(mean) && mean < best) {
            best = mean;
            pSource = (col.p[i] + pLayerTop) / 2;
        }
    }
    if (!Number.isFinite(pSource)) return null;

    const te0 = interpolateLogP(col.p, col.t, pSource);
    const td0 = interpolateLogP(col.p, col.td, pSource);
    const h0 = interpolateLogP(col.p, col.z, pSource);
    if (!Number.isFinite(te0) || !Number.isFinite(td0) || !Number.isFinite(h0)) return null;
    let tp1 = wetBulbC(pSource, te0, td0);
    let te1 = te0;
    let h1 = h0;
    let pe1 = pSource;

    let dcape = 0;
    for (let j = col.p.length - 1; j >= 0; j--) {
        if (col.p[j] < pSource) continue; // above the downdraft source: not part of the descent
        const pe2 = col.p[j];
        const te2 = col.t[j];
        const h2 = col.z[j];
        const tp2 = wetLiftC(pe1, tp1, pe2);
        const tdef1 = (tp1 - te1) / (te1 + SOUNDING_KELVIN_OFFSET);
        const tdef2 =
            Number.isFinite(tp2) && Number.isFinite(te2) ? (tp2 - te2) / (te2 + SOUNDING_KELVIN_OFFSET) : NaN;
        const mid = (tdef1 + tdef2) / 2; // negative buoyancy: the parcel is colder than its environment
        const lyre = DCAPE_GRAVITY * mid * (h2 - h1); // h2 - h1 < 0 descending, so cold strips are positive
        if (Number.isFinite(lyre) && mid < 0) dcape += lyre;
        pe1 = pe2;
        te1 = te2;
        h1 = h2;
        tp1 = tp2;
    }
    return dcape;
}
