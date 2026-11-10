/**
 * What the SHARPpy-style plate shows beyond the parcel and kinematic tables: the strips beside the Skew-T, the four insets under the
 * hodograph, the hazard type, the dendritic growth zone and the precipitation-type panel. Pure; nothing here knows a colour or a size.
 *
 * These are EdgeWARN's own simplified takes on SHARPpy's panels (SHARPpy needs its full source code and, for SARS, an analog
 * archive), so each says in its comment what it does.
 */

import { equivalentPotentialTemperature, mixingRatioHpa, saturationVapourPressure } from './bolton.ts';
import { SOUNDING_GRAVITY, SOUNDING_KELVIN_OFFSET, SOUNDING_RD } from './constants.ts';
import { fieldAt, heightAt, heightsAgl, levelOfTemperature, pressureAtAgl } from './interp.ts';
import { wetBulbC } from './thermo.ts';
import type { Column, ParcelResult, SoundingAnalysis, Vec2 } from './types.ts';

const EARTH_ROTATION = 7.292e-5; // rad/s
const SECONDS_PER_HOUR = 3600;
const FEET_PER_METRE = 3.28084;
const METRES_PER_KM = 1000;
const MM_PER_INCH = 25.4;
const DGZ_WARM_C = -12;
const DGZ_COLD_C = -17;
const SATURATED_RH = 90;
const SNOW_TOP_C = -10;
const LAYER_STEP_HPA = 5;
const SLINKY_STEP_M = 250;
const SLINKY_UPDRAFT_SHARE = 0.5;
const PASCAL_PER_HPA = 100;
const MICROBAR_PER_PASCAL = 10;
const SR_TOP_M = 14000;
const THETA_E_BOTTOM_HPA = 500;
const WIND_HIGH_HPA = 230;
const WIND_MID_HPA = 420;
const WIND_LOW_HPA = 880;

/* ---- strips beside the Skew-T ---- */

export type WindTone = 'high' | 'mid' | 'low' | 'surface';

/** The colour family of a level on the barb and speed columns, by pressure. */
export function windTone(pHpa: number): WindTone {
    if (pHpa <= WIND_HIGH_HPA) return 'high';
    if (pHpa <= WIND_MID_HPA) return 'mid';
    return pHpa <= WIND_LOW_HPA ? 'low' : 'surface';
}

/**
 * Temperature advection inferred from the wind turning with height (the thermal-wind relation SHARPpy uses): warm where the wind
 * veers, cold where it backs, in K per hour, one value per layer between neighbouring levels. `latDeg` sets the Coriolis parameter.
 */
export function inferredAdvection(levels: readonly { pHpa: number; u: number; v: number }[], latDeg: number): { pHpa: number; perHour: number }[] {
    const f = 2 * EARTH_ROTATION * Math.sin((latDeg * Math.PI) / 180);
    const out: { pHpa: number; perHour: number }[] = [];
    for (let k = 1; k < levels.length; k++) {
        const low = levels[k - 1];
        const high = levels[k];
        const span = Math.log(low.pHpa / high.pHpa);
        if (!(span > 0)) continue;
        const [um, vm] = [(low.u + high.u) / 2, (low.v + high.v) / 2];
        const [shearU, shearV] = [high.u - low.u, high.v - low.v];
        const perSecond = (f / (SOUNDING_RD * span)) * (vm * shearU - um * shearV);
        out.push({ pHpa: Math.sqrt(low.pHpa * high.pHpa), perHour: perSecond * SECONDS_PER_HOUR });
    }
    return out;
}

/* ---- insets ---- */

/** Storm-relative wind speed (m/s) against height (km AGL), from the surface to 14 km. */
export function stormRelativeProfile(col: Column, storm: Vec2): { zKm: number; speedMs: number }[] {
    const agl = heightsAgl(col);
    const out: { zKm: number; speedMs: number }[] = [];
    for (let k = 0; k < col.p.length; k++) {
        if (agl[k] > SR_TOP_M) break;
        if (Number.isFinite(col.u[k]) && Number.isFinite(col.v[k])) out.push({ zKm: agl[k] / METRES_PER_KM, speedMs: Math.hypot(col.u[k] - storm.u, col.v[k] - storm.v) });
    }
    return out;
}

/** Equivalent potential temperature (K) against pressure from the surface to 500 hPa; levels with no moisture are left out. */
export function thetaEProfile(col: Column): { pHpa: number; thetaEK: number }[] {
    const out: { pHpa: number; thetaEK: number }[] = [];
    for (let k = 0; k < col.p.length; k++) {
        if (col.p[k] < THETA_E_BOTTOM_HPA) break;
        const value = equivalentPotentialTemperature(col.p[k], col.t[k], col.td[k]);
        if (Number.isFinite(value)) out.push({ pHpa: col.p[k], thetaEK: value });
    }
    return out;
}

export interface Slinky {
    /** Storm-relative displacement (m) of a rising parcel, east and north, by height AGL (m). */
    points: { x: number; y: number; zM: number }[];
    /** The lean of the updraft from vertical, degrees. */
    tiltDeg: number;
}

/**
 * A rising parcel's track relative to the storm: it climbs from the LFC (or LCL) to the EL at half of sqrt(2 CAPE), carried by
 * the storm-relative wind at each height. Null without CAPE. A simplification of SHARPpy's Storm Slinky.
 */
export function stormSlinky(col: Column, parcel: ParcelResult, storm: Vec2): Slinky | null {
    const base = parcel.lfcZagl ?? parcel.lclZagl;
    const top = parcel.elZagl;
    if (parcel.cape === null || parcel.cape <= 0 || base === null || top === null || !(top > base)) return null;
    const rise = SLINKY_UPDRAFT_SHARE * Math.sqrt(2 * parcel.cape);
    const points: Slinky['points'] = [{ x: 0, y: 0, zM: base }];
    let [x, y] = [0, 0];
    for (let z = base + SLINKY_STEP_M; z <= top; z += SLINKY_STEP_M) {
        const p = pressureAtAgl(col, z);
        const [u, v] = [fieldAt(col, 'u', p), fieldAt(col, 'v', p)];
        if (!Number.isFinite(u) || !Number.isFinite(v)) continue;
        const dt = SLINKY_STEP_M / rise;
        x += (u - storm.u) * dt;
        y += (v - storm.v) * dt;
        points.push({ x, y, zM: z });
    }
    if (points.length < 2) return null;
    return { points, tiltDeg: (Math.atan2(Math.hypot(x, y), top - base) * 180) / Math.PI };
}

/** What the plate calls the hazard: the strongest of the composites it can name, or NONE. EdgeWARN thresholds, not SHARPpy's. */
export function hazardType(analysis: SoundingAnalysis): string {
    const { composites: c, parcels, kinematics } = analysis;
    const stp = Math.max(c.stpEff ?? 0, c.stpFixed ?? 0);
    if (stp >= 4) return 'PDS TOR';
    if (stp >= 1) return 'TOR';
    if (stp >= 0.5 && (c.scp ?? 0) >= 1) return 'MRGL TOR';
    if ((c.ship ?? 0) >= 1 || (c.scp ?? 0) >= 4) return 'SVR';
    if ((c.scp ?? 0) >= 1 || ((parcels.mu.cape ?? 0) >= 500 && (kinematics.shear06 ?? 0) >= 15)) return 'MRGL SVR';
    return 'NONE';
}

/* ---- dendritic growth zone and precipitation ---- */

const relativeHumidity = (tC: number, tdC: number): number => (saturationVapourPressure(tdC) / saturationVapourPressure(tC)) * 100;
const toFeet = (m: number): number => m * FEET_PER_METRE;

export interface GrowthZone {
    baseFtMsl: number;
    topFtMsl: number;
    depthFt: number;
    /** Means over the layer; null where the column has no moisture there. */
    meanRh: number | null;
    meanMixingGkg: number | null;
    pwIn: number | null;
    /** Mean vertical motion (microbar/s), when the model carried it; with OPRH = omega x PW x RH. */
    omegaUbs: number | null;
    oprh: number | null;
}

/** The vertical-motion column interpolated to a pressure (log-p), NaN if the model has none. */
function verticalAt(col: Column, pHpa: number): number {
    const values = col.vertical?.values;
    if (!values) return Number.NaN;
    for (let k = 1; k < col.p.length; k++) {
        if (col.p[k] <= pHpa && col.p[k - 1] >= pHpa) {
            const share = Math.log(col.p[k - 1] / pHpa) / Math.log(col.p[k - 1] / col.p[k]);
            return values[k - 1] + (values[k] - values[k - 1]) * share;
        }
    }
    return Number.NaN;
}

/** The layer between -12 and -17 °C and its means, or null when the profile does not cross both. */
export function dendriticGrowthZone(col: Column): GrowthZone | null {
    const pA = levelOfTemperature(col, DGZ_WARM_C);
    const pB = levelOfTemperature(col, DGZ_COLD_C);
    if (!Number.isFinite(pA) || !Number.isFinite(pB)) return null;
    const [lowP, highP] = pA > pB ? [pA, pB] : [pB, pA];
    const zLow = heightAt(col, lowP);
    const zHigh = heightAt(col, highP);
    let [rh, mix, count, pwKgM2, omega, omegaCount] = [0, 0, 0, 0, 0, 0];
    for (let p = lowP; p > highP; p -= LAYER_STEP_HPA) {
        const [t, td] = [fieldAt(col, 't', p), fieldAt(col, 'td', p)];
        if (!Number.isFinite(t) || !Number.isFinite(td)) continue;
        rh += relativeHumidity(t, td);
        const mixingGkg = mixingRatioHpa(p, td);
        mix += mixingGkg;
        pwKgM2 += ((mixingGkg / 1000) * LAYER_STEP_HPA * PASCAL_PER_HPA) / SOUNDING_GRAVITY;
        count++;
        const w = verticalAt(col, p);
        if (Number.isFinite(w)) {
            const rho = (p * PASCAL_PER_HPA) / (SOUNDING_RD * (t + SOUNDING_KELVIN_OFFSET));
            omega += -rho * SOUNDING_GRAVITY * w;
            omegaCount++;
        }
    }
    const meanRh = count ? rh / count : null;
    const pwIn = count ? pwKgM2 / MM_PER_INCH : null;
    const omegaUbs = omegaCount ? (omega / omegaCount) * MICROBAR_PER_PASCAL : null;
    return {
        baseFtMsl: toFeet(zLow), topFtMsl: toFeet(zHigh), depthFt: toFeet(zHigh - zLow), meanRh,
        meanMixingGkg: count ? mix / count : null, pwIn, omegaUbs,
        oprh: omegaUbs !== null && pwIn !== null && meanRh !== null ? (omegaUbs / MICROBAR_PER_PASCAL) * pwIn * (meanRh / 100) : null,
    };
}

export interface TemperatureLayer { kind: 'warm' | 'cold'; baseFtMsl: number; topFtMsl: number }

/** The warm layers aloft (above 0 °C) over a surface at or below 0 °C; a warm surface has none, since the air above it is always colder. */
export function layersAloft(values: readonly number[], z: ArrayLike<number>): TemperatureLayer[] {
    if (values[0] > 0) return [];
    const crossings: number[] = [];
    for (let k = 1; k < values.length; k++) {
        const [a, b] = [values[k - 1], values[k]];
        if (!Number.isFinite(a) || !Number.isFinite(b) || a > 0 === b > 0) continue;
        crossings.push(z[k - 1] + ((0 - a) / (b - a)) * (z[k] - z[k - 1]));
    }
    const layers: TemperatureLayer[] = [];
    for (let k = 0; k < crossings.length; k += 2) {
        layers.push({ kind: 'warm', baseFtMsl: toFeet(crossings[k]), topFtMsl: toFeet(crossings[k + 1] ?? z[z.length - 1]) });
    }
    return layers;
}

export interface PrecipitationPanel {
    initialPhase: 'none' | 'rain' | 'snow';
    temperatureLayers: TemperatureLayer[];
    wetBulbLayers: TemperatureLayer[];
    bestGuess: 'None' | 'Rain' | 'Snow' | 'Freezing rain';
}

/**
 * A plain take on SHARPpy's precipitation-type panel: the top of the saturated air (90% RH or more) sets the initial phase, the
 * layers on the temperature and wet-bulb profiles that differ from the surface are listed, and the best guess comes from the
 * surface wet bulb and whether a warm layer sits aloft.
 */
export function precipitationPanel(col: Column): PrecipitationPanel {
    let topT: number | null = null;
    for (let k = col.p.length - 1; k >= 0; k--) {
        if (Number.isFinite(col.td[k]) && relativeHumidity(col.t[k], col.td[k]) >= SATURATED_RH) { topT = col.t[k]; break; }
    }
    const wet = Array.from(col.p, (p, k) => wetBulbC(p, col.t[k], col.td[k]));
    const temperatureLayers = layersAloft(Array.from(col.t), col.z);
    const wetBulbLayers = layersAloft(wet, col.z);
    const warmAloft = temperatureLayers.some((l) => l.kind === 'warm') || wetBulbLayers.some((l) => l.kind === 'warm');
    let bestGuess: PrecipitationPanel['bestGuess'] = 'Snow';
    if (topT === null) bestGuess = 'None';
    else if (wet[0] > 0 && col.t[0] > 0) bestGuess = 'Rain';
    else if (warmAloft) bestGuess = 'Freezing rain';
    return { initialPhase: topT === null ? 'none' : topT <= SNOW_TOP_C ? 'snow' : 'rain', temperatureLayers, wetBulbLayers, bestGuess };
}
