import { equivalentPotentialTemperature } from '../bolton.ts';
import { SOUNDING_CIN_LIMIT_HPA } from '../constants.ts';
import { fieldAt, heightAglAt, interpolateLogP, pressureAtAgl } from '../interp.ts';
import { tempAtMixratioC, temperatureFromThetaC, virtualTemperatureC, wetBulbC, wetLiftC } from '../thermo.ts';
import type { Column, ParcelResult } from '../types.ts';
import { windFromComponents } from '../wind.ts';
import { barbSymbol } from './barb.ts';
import type { BarbSymbol } from './barb.ts';
import {
    SOUNDING_SKEWT, SOUNDING_SKEWT_BARB_MIN_GAP, SOUNDING_SKEWT_DRY_ADIABAT_RANGE_C, SOUNDING_SKEWT_DRY_ADIABAT_STEP_C,
    SOUNDING_SKEWT_HEIGHT_TICKS_KM, SOUNDING_SKEWT_ISOBARS_HPA, SOUNDING_SKEWT_ISOTHERM_RANGE_C, SOUNDING_SKEWT_ISOTHERM_STEP_C,
    SOUNDING_SKEWT_MIXING_RATIOS_GKG, SOUNDING_SKEWT_MIXING_RATIO_TOP_HPA, SOUNDING_SKEWT_MOIST_ADIABATS_C,
} from './constants.ts';

/**
 * Skew-T/log-P geometry (phase 5.4): the mapping from (temperature, pressure) to viewBox units, the background lines, the
 * data traces, CAPE/CIN areas, level markers and wind-barb data, all as plain numbers for an SVG to draw. Pure; nothing
 * here knows a colour or a size. y grows downward, 0 at the top pressure; isotherms lean right going up.
 */

/** @public */
export interface Pt { x: number; y: number }

export interface SkewTOptions {
    size?: number;
    pBottomHpa?: number;
    pTopHpa?: number;
    tMinC?: number;
    tMaxC?: number;
    skew?: number;
}

/** @public */
export interface SkewT {
    width: number;
    height: number;
    pBottomHpa: number;
    pTopHpa: number;
    y(pHpa: number): number;
    x(tC: number, pHpa: number): number;
    point(tC: number, pHpa: number): Pt;
    /** Back from viewBox units, for a crosshair or a drag. */
    invert(x: number, y: number): { tC: number; pHpa: number };
}

/** The Skew-T mapping. The left edge at the bottom pressure is `tMinC`, the right edge `tMaxC`. */
export function createSkewT(options: SkewTOptions = {}): SkewT {
    const { size, pBottomHpa, pTopHpa, tMinC, tMaxC, skew } = { ...SOUNDING_SKEWT, ...options };
    const logSpan = Math.log(pBottomHpa / pTopHpa);
    const tSpan = tMaxC - tMinC;
    const y = (pHpa: number): number => size * Math.log(pHpa / pTopHpa) / logSpan;
    const x = (tC: number, pHpa: number): number => (tC - tMinC) / tSpan * size + skew * (size - y(pHpa));
    return {
        width: size, height: size, pBottomHpa, pTopHpa, y, x,
        point: (tC, pHpa) => ({ x: x(tC, pHpa), y: y(pHpa) }),
        invert: (px, py) => ({
            pHpa: pTopHpa * Math.exp(py / size * logSpan),
            tC: tMinC + (px - skew * (size - py)) / size * tSpan,
        }),
    };
}

/* ------------------------------------------------------------------ */
/* Clipping                                                            */
/* ------------------------------------------------------------------ */

interface ClippedSegment { a: Pt; b: Pt; startClipped: boolean; endClipped: boolean }

/** Liang-Barsky: the part of the segment inside [0, w] x [0, h], or null. */
function clipSegment(a: Pt, b: Pt, w: number, h: number): ClippedSegment | null {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const edges: [number, number][] = [[-dx, a.x], [dx, w - a.x], [-dy, a.y], [dy, h - a.y]];
    let t0 = 0;
    let t1 = 1;
    for (const [p, q] of edges) {
        if (p === 0) {
            if (q < 0) return null;
            continue;
        }
        const r = q / p;
        if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
    }
    return {
        a: { x: a.x + t0 * dx, y: a.y + t0 * dy }, b: { x: a.x + t1 * dx, y: a.y + t1 * dy },
        startClipped: t0 > 0, endClipped: t1 < 1,
    };
}

/** A polyline cut to the frame: one run per stretch inside it, ending exactly on the edge where it leaves. */
export function clipPolyline(points: readonly Pt[], w: number, h: number): Pt[][] {
    const runs: Pt[][] = [];
    let current: Pt[] | null = null;
    for (let k = 1; k < points.length; k++) {
        const a = points[k - 1];
        const b = points[k];
        const seg = [a.x, a.y, b.x, b.y].every(Number.isFinite) ? clipSegment(a, b, w, h) : null;
        if (!seg) { current = null; continue; }
        if (current && !seg.startClipped) current.push(seg.b);
        else { current = [seg.a, seg.b]; runs.push(current); }
        if (seg.endClipped) current = null;
    }
    return runs;
}

/* ------------------------------------------------------------------ */
/* Background                                                          */
/* ------------------------------------------------------------------ */

/** One family member: its value (hPa, degC, K-step or g/kg by family) and the polyline runs inside the frame. */
export interface BackgroundLine { value: number; lines: Pt[][] }

/** @public */
export interface SkewTBackground {
    isobars: { pHpa: number; y: number }[];
    isotherms: BackgroundLine[];
    /** By potential temperature, degC. */
    dryAdiabats: BackgroundLine[];
    /** By the temperature the line has at 1000 hPa, degC. */
    moistAdiabats: BackgroundLine[];
    /** By mixing ratio, g/kg. */
    mixingRatios: BackgroundLine[];
}

/** Which background lines to draw. Each field defaults to the exported `SOUNDING_SKEWT_*` constant of the same meaning. */
export interface SkewTBackgroundOptions {
    isobarsHpa?: readonly number[];
    isothermStepC?: number;
    isothermRangeC?: { readonly min: number; readonly max: number };
    dryAdiabatStepC?: number;
    dryAdiabatRangeC?: { readonly min: number; readonly max: number };
    moistAdiabatsC?: readonly number[];
    mixingRatiosGkg?: readonly number[];
    mixingRatioTopHpa?: number;
    /** Spacing of the sampled adiabats and mixing-ratio lines, hPa. */
    lineStepHpa?: number;
}

const pressureGrid = (skewT: SkewT, topHpa: number, stepHpa: number): number[] => {
    const grid: number[] = [];
    for (let p = skewT.pBottomHpa; p > topHpa; p -= stepHpa) grid.push(p);
    grid.push(topHpa);
    return grid;
};

const curve = (skewT: SkewT, grid: readonly number[], tAt: (pHpa: number) => number): BackgroundLine['lines'] =>
    clipPolyline(grid.map((p) => skewT.point(tAt(p), p)), skewT.width, skewT.height);

const steps = (min: number, max: number, step: number): number[] => {
    const out: number[] = [];
    for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(v);
    return out;
};

export function skewTBackground(skewT: SkewT, options: SkewTBackgroundOptions = {}): SkewTBackground {
    const { pBottomHpa, pTopHpa } = skewT;
    const step = options.lineStepHpa ?? SOUNDING_SKEWT.lineStepHpa;
    const full = pressureGrid(skewT, pTopHpa, step);
    const mixing = pressureGrid(skewT, options.mixingRatioTopHpa ?? SOUNDING_SKEWT_MIXING_RATIO_TOP_HPA, step);
    const iso = options.isothermRangeC ?? SOUNDING_SKEWT_ISOTHERM_RANGE_C;
    const dry = options.dryAdiabatRangeC ?? SOUNDING_SKEWT_DRY_ADIABAT_RANGE_C;
    return {
        isobars: (options.isobarsHpa ?? SOUNDING_SKEWT_ISOBARS_HPA).filter((p) => p <= pBottomHpa && p >= pTopHpa).map((pHpa) => ({ pHpa, y: skewT.y(pHpa) })),
        isotherms: steps(iso.min, iso.max, options.isothermStepC ?? SOUNDING_SKEWT_ISOTHERM_STEP_C).map((tC) => ({
            value: tC, lines: clipPolyline([skewT.point(tC, pBottomHpa), skewT.point(tC, pTopHpa)], skewT.width, skewT.height),
        })),
        dryAdiabats: steps(dry.min, dry.max, options.dryAdiabatStepC ?? SOUNDING_SKEWT_DRY_ADIABAT_STEP_C).map((theta) => ({
            value: theta, lines: curve(skewT, full, (p) => temperatureFromThetaC(theta, p)),
        })),
        moistAdiabats: (options.moistAdiabatsC ?? SOUNDING_SKEWT_MOIST_ADIABATS_C).map((t0) => ({ value: t0, lines: curve(skewT, full, (p) => wetLiftC(1000, t0, p)) })),
        mixingRatios: (options.mixingRatiosGkg ?? SOUNDING_SKEWT_MIXING_RATIOS_GKG).map((r) => ({ value: r, lines: curve(skewT, mixing, (p) => tempAtMixratioC(r, p)) })),
    };
}

/** Where each height above ground (km) falls on the pressure axis for this column; heights above the profile are left out. */
export function heightTicks(
    skewT: SkewT, col: Column, ticksKm: readonly number[] = SOUNDING_SKEWT_HEIGHT_TICKS_KM,
): { km: number; pHpa: number; y: number }[] {
    const ticks: { km: number; pHpa: number; y: number }[] = [];
    for (const km of ticksKm) {
        const pHpa = pressureAtAgl(col, km * 1000);
        if (Number.isFinite(pHpa) && pHpa >= skewT.pTopHpa) ticks.push({ km, pHpa, y: skewT.y(pHpa) });
    }
    return ticks;
}

/* ------------------------------------------------------------------ */
/* Traces                                                              */
/* ------------------------------------------------------------------ */

export type SkewTTrace ='t' | 'td' | 'tv' | 'tw';

/**
 * A temperature curve of the column as runs of points (a run ends where the value is missing, as dewpoint is above the
 * moisture the model carries). `tv` is virtual temperature and `tw` the wet bulb. Levels above the top pressure are kept: the
 * page clips to its frame.
 */
export function columnTrace(skewT: SkewT, col: Column, kind: SkewTTrace): Pt[][] {
    const runs: Pt[][] = [];
    let current: Pt[] | null = null;
    for (let k = 0; k < col.p.length; k++) {
        const p = col.p[k];
        const value = kind === 't' ? col.t[k] : kind === 'td' ? col.td[k]
            : kind === 'tv' ? virtualTemperatureC(p, col.t[k], col.td[k]) : wetBulbC(p, col.t[k], col.td[k]);
        if (!Number.isFinite(value)) { current = null; continue; }
        if (!current) { current = []; runs.push(current); }
        current.push(skewT.point(value, p));
    }
    return runs;
}

/** A parcel's virtual-temperature trace in viewBox units. */
export const parcelTrace = (skewT: SkewT, parcel: ParcelResult): Pt[] => parcel.trace.map((s) => skewT.point(s.tv, s.p));

/** LCL, LFC and EL of a parcel as ticks on the pressure axis, in that order, leaving out what the parcel does not have. */
export function parcelMarkers(skewT: SkewT, parcel: ParcelResult): { kind: 'lcl' | 'lfc' | 'el'; pHpa: number; y: number; zAglM: number | null }[] {
    const levels = [
        { kind: 'lcl', pHpa: parcel.lclP, zAglM: parcel.lclZagl }, { kind: 'lfc', pHpa: parcel.lfcP, zAglM: parcel.lfcZagl },
        { kind: 'el', pHpa: parcel.elP, zAglM: parcel.elZagl },
    ] as const;
    return levels.flatMap((l) => (l.pHpa === null ? [] : [{ kind: l.kind, pHpa: l.pHpa, y: skewT.y(l.pHpa), zAglM: l.zAglM }]));
}

/**
 * The shaded areas between a parcel's trace and the environment's virtual temperature: CAPE where it is warmer between the
 * LFC and the EL, CIN where it is cooler below the CIN limit pressure, as the analysis counts it (the reported LFC is the
 * lowest one, so a cap above it still counts as CIN). Each polygon runs along the
 * parcel and back along the environment; crossings are placed linearly in ln p between the trace's samples.
 */
export function buoyancyAreas(skewT: SkewT, col: Column, parcel: ParcelResult): { cape: Pt[][]; cin: Pt[][] } {
    const envTv = Float32Array.from(col.p, (p, k) => virtualTemperatureC(p, col.t[k], col.td[k]));
    const samples = [...parcel.trace].sort((a, b) => b.p - a.p)
        .map((s) => ({ p: s.p, parcel: s.tv, env: interpolateLogP(col.p, envTv, s.p) }))
        .filter((s) => Number.isFinite(s.env) && Number.isFinite(s.parcel));
    const out: { cape: Pt[][]; cin: Pt[][] } = { cape: [], cin: [] };
    if (samples.length < 2) return out;

    let run: typeof samples = [samples[0]];
    const flush = (): void => {
        if (run.length >= 2) {
            const positive = run.some((s) => s.parcel > s.env);
            const mid = (run[0].p + run[run.length - 1].p) / 2;
            const polygon = [...run.map((s) => skewT.point(s.parcel, s.p)), ...run.map((s) => skewT.point(s.env, s.p)).reverse()];
            if (positive && parcel.lfcP !== null && mid <= parcel.lfcP && mid >= (parcel.elP ?? 0)) out.cape.push(polygon);
            if (!positive && mid >= SOUNDING_CIN_LIMIT_HPA) out.cin.push(polygon);
        }
    };
    for (let k = 1; k < samples.length; k++) {
        const a = samples[k - 1];
        const b = samples[k];
        const da = a.parcel - a.env;
        const db = b.parcel - b.env;
        if (da * db < 0) {
            // The sign changes between the two: close this run on the crossing and open the next one on it.
            const f = da / (da - db);
            const p = Math.exp(Math.log(a.p) + f * (Math.log(b.p) - Math.log(a.p)));
            const tv = a.parcel + f * (b.parcel - a.parcel);
            const crossing = { p, parcel: tv, env: tv };
            run.push(crossing);
            flush();
            run = [crossing];
        }
        run.push(b);
    }
    flush();
    return out;
}

/* ------------------------------------------------------------------ */
/* Winds and readout                                                   */
/* ------------------------------------------------------------------ */

/** @public */
export interface BarbData extends BarbSymbol {
    pHpa: number;
    y: number;
    u: number;
    v: number;
    speedMs: number;
    /** Direction the wind blows FROM, degrees. */
    dirDeg: number;
}

/** Wind barbs from the surface up, thinned so none is closer than the minimum gap along the pressure axis. */
export function windBarbs(skewT: SkewT, col: Column, minGap = SOUNDING_SKEWT_BARB_MIN_GAP): BarbData[] {
    const barbs: BarbData[] = [];
    let lastY = Number.POSITIVE_INFINITY;
    for (let k = 0; k < col.p.length; k++) {
        const pHpa = col.p[k];
        const u = col.u[k];
        const v = col.v[k];
        if (!Number.isFinite(u) || !Number.isFinite(v) || pHpa < skewT.pTopHpa) continue;
        const y = skewT.y(pHpa);
        if (lastY - y < minGap) continue;
        lastY = y;
        barbs.push({ pHpa, y, u, v, ...windFromComponents(u, v), ...barbSymbol(Math.hypot(u, v)) });
    }
    return barbs;
}

/** @public */
export interface LevelReadout {
    pHpa: number;
    zAglM: number;
    tC: number;
    tdC: number;
    thetaEK: number;
    u: number;
    v: number;
    speedMs: number;
    dirDeg: number;
}

/** The hover readout at a pressure: null outside the profile. Dewpoint and θe are NaN where the column has no moisture. */
export function levelReadout(col: Column, pHpa: number): LevelReadout | null {
    const tC = fieldAt(col, 't', pHpa);
    const u = fieldAt(col, 'u', pHpa);
    const v = fieldAt(col, 'v', pHpa);
    if (!Number.isFinite(tC)) return null;
    const tdC = fieldAt(col, 'td', pHpa);
    return {
        pHpa, zAglM: heightAglAt(col, pHpa), tC, tdC,
        thetaEK: Number.isFinite(tdC) ? equivalentPotentialTemperature(pHpa, tC, tdC) : Number.NaN,
        u, v, ...windFromComponents(u, v),
    };
}
