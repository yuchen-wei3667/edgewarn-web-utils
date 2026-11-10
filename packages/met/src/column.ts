import { dewpointFromRelativeHumidity } from './bolton.ts';
import {
    SOUNDING_GRAVITY, SOUNDING_KELVIN_OFFSET, SOUNDING_RD, SOUNDING_STANDARD_LAPSE_K_PER_M, SOUNDING_SURFACE_GAP_HPA,
} from './constants.ts';
import type { Column } from './types.ts';

/**
 * Raw model values to a `Column` (phase 5 plan, 5.3 "Building a column"). Pure: the source reads the numbers, this
 * decides what they mean. Winds arrive relative to the provider's grid and leave relative to the earth; the dewpoint is
 * never taken from the provider but always derived from temperature and relative humidity, so every source runs the
 * same maths.
 */

/** One pressure level of the provider's copy. NaN marks a value the copy lacks. */
export interface RawLevel {
    p: number; // hPa
    z: number; // m MSL
    t: number; // °C
    rh: number; // %
    gu: number; // m/s, grid-relative
    gv: number;
    w?: number; // m/s
}

/** The surface inputs: 2 m temperature and humidity, 10 m wind, and the model's terrain height. */
export interface RawSurface {
    t: number;
    rh: number;
    gu: number;
    gv: number;
    hsurf: number; // m MSL
}

/** Winds turned from the grid's axes to east and north (`angle`: how far +i points clockwise of east, radians). */
export function rotateWind(gu: number, gv: number, angle: number): [number, number] {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return [gu * cos + gv * sin, -gu * sin + gv * cos];
}

export interface SurfacePressure { p: number; method: 'bracket' | 'hypsometric' }

/**
 * The model's surface pressure, from what the copy has: it carries no surface pressure, and MSL pressure is not it.
 * The pressure levels' own heights place the terrain: where two levels bracket `hsurf`, interpolate ln p linearly in
 * height (within about 0.5 hPa over 25 hPa spacing). Where the terrain is below the lowest level (high pressure near
 * sea level) integrate hypsometrically down from it with the standard lapse rate. Null if the terrain is above every
 * level. `levels` run from the highest pressure up.
 */
export function surfacePressure(
    levels: readonly Pick<RawLevel, 'p' | 'z' | 't'>[], hsurf: number, lapseKPerM: number = SOUNDING_STANDARD_LAPSE_K_PER_M,
): SurfacePressure | null {
    if (!levels.length || !Number.isFinite(hsurf)) return null;
    const first = levels[0];
    if (hsurf < first.z) {
        const meanK = first.t + SOUNDING_KELVIN_OFFSET + lapseKPerM * (first.z - hsurf) / 2;
        return { p: first.p * Math.exp(SOUNDING_GRAVITY * (first.z - hsurf) / (SOUNDING_RD * meanK)), method: 'hypsometric' };
    }
    for (let k = 0; k + 1 < levels.length; k++) {
        const lo = levels[k];
        const hi = levels[k + 1];
        if (lo.z <= hsurf && hsurf < hi.z) {
            const f = (hsurf - lo.z) / (hi.z - lo.z);
            return { p: Math.exp(Math.log(lo.p) + f * (Math.log(hi.p) - Math.log(lo.p))), method: 'bracket' };
        }
    }
    return null;
}

export interface BuiltColumn { column: Column; surfaceP: SurfacePressure; dropped: number }

/**
 * One valid time's column, surface row first. A level is dropped when its pressure, height or temperature is missing,
 * when it lies at or below the ground, or when its height does not rise above the level under it. Null when no surface
 * row can be made (missing surface values, or no surface pressure).
 */
export interface BuildColumnOptions {
    /** Mean lapse rate of the hypsometric surface-pressure estimate, K/m. Default: US Standard Atmosphere. */
    lapseKPerM?: number;
    /** A level this close to the surface pressure (or closer) duplicates the surface row and is dropped, hPa. */
    surfaceGapHpa?: number;
}

export function buildColumn(
    validMs: number, rawLevels: readonly RawLevel[], surface: RawSurface, rotation: number, vertical = false, options: BuildColumnOptions = {},
): BuiltColumn | null {
    const usable = rawLevels.filter((l) => Number.isFinite(l.p) && Number.isFinite(l.z) && Number.isFinite(l.t));
    const ps = surfacePressure(usable, surface.hsurf, options.lapseKPerM);
    if (!ps || !Number.isFinite(surface.t)) return null;
    const [su, sv] = rotateWind(surface.gu, surface.gv, rotation);
    if (!Number.isFinite(su) || !Number.isFinite(sv)) return null;

    const kept: RawLevel[] = [];
    let topZ = surface.hsurf;
    for (const level of usable) {
        if (level.p >= ps.p - (options.surfaceGapHpa ?? SOUNDING_SURFACE_GAP_HPA) || level.z <= topZ) continue;
        kept.push(level);
        topZ = level.z;
    }
    if (!kept.length) return null;

    const n = kept.length + 1;
    const p = new Float32Array(n), z = new Float32Array(n), t = new Float32Array(n), td = new Float32Array(n);
    const u = new Float32Array(n), v = new Float32Array(n);
    const surfaceTd = dewpointFromRelativeHumidity(surface.t, surface.rh);
    p[0] = ps.p; z[0] = surface.hsurf; t[0] = surface.t; td[0] = surfaceTd; u[0] = su; v[0] = sv;
    kept.forEach((level, k) => {
        const [lu, lv] = rotateWind(level.gu, level.gv, rotation);
        p[k + 1] = level.p; z[k + 1] = level.z; t[k + 1] = level.t;
        td[k + 1] = dewpointFromRelativeHumidity(level.t, level.rh);
        u[k + 1] = lu; v[k + 1] = lv;
    });
    const column: Column = {
        validMs, p, z, t, td, u, v,
        surface: { p: p[0], z: z[0], t: t[0], td: td[0], u: u[0], v: v[0] },
    };
    if (vertical && kept.every((l) => l.w !== undefined)) {
        // The surface row has no vertical velocity: NaN, not the lowest level's.
        column.vertical = { units: 'm/s', values: Float32Array.from([Number.NaN, ...kept.map((l) => l.w as number)]) };
    }
    return { column, surfaceP: ps, dropped: rawLevels.length - kept.length };
}
