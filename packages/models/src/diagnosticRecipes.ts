import {
    DERIVATIVE_EARTH_RADIUS_M,
    EARTH_ROTATION_RAD_S,
    FRONTOGENESIS_DISTANCE_M,
    FRONTOGENESIS_PERIOD_S,
    GRAMS_PER_KG,
    METRES_PER_KM,
    PASCALS_PER_HPA,
    PVU_PER_SI,
    Q_VECTOR_CONVERGENCE_FACTOR,
    Q_VECTOR_CONVERGENCE_STORED_PER_SI,
    Q_VECTOR_STORED_PER_SI,
    SECONDS_PER_HOUR,
    STORM_MEAN_DEPTH_M,
    STORM_MEAN_MIN_DEPTH_M,
    VORTICITY_STORED_PER_SI,
} from './limits.ts';
import { SOUNDING_GRAVITY, SOUNDING_RD } from '@edgewarn/web-utils/met';
import type { ModelRecipe, ModelRecipeParams } from './configs/types.ts';
import { ehi, stpFixed, bunkersDeviate, thetaK } from '@edgewarn/web-utils/met';
import { gradient, gridMetrics } from './derivatives.ts';
import { HALF_NAN, fromHalf, toHalf, type LevelGrid } from '@edgewarn/web-utils/grib2';
import type { GridProjection } from './projection/types.ts';
import { rotateToEarth } from './winds.ts';

/**
 * The diagnostic recipes (phase 5.9, ADR-P5-8): fixed fields derived from several of the model's own fields. Each one
 * is computed on the full-resolution grid and decimated afterwards, because a derivative does not commute with averaging.
 * The composites (STP, EHI) are built from the model's computed inputs (CAPE, SRH, shear), never from a parcel computed at
 * every cell, and use the same functions as the sounding page's single-point composites (`@edgewarn/web-utils/met`).
 */

export type DiagnosticRecipe = Extract<
    ModelRecipe,
    | 'advection'
    | 'frontogenesis'
    | 'moisture-flux'
    | 'stp-fixed'
    | 'ehi'
    | 'lapse-rate'
    | 'ivt'
    | 'potential-vorticity'
    | 'q-vector'
    | 'differential-advection'
    | 'isentropic'
    | 'storm-relative'
    | 'absolute-vorticity'
>;

export const DIAGNOSTIC_RECIPES: ReadonlySet<ModelRecipe> = new Set<DiagnosticRecipe>([
    'advection',
    'frontogenesis',
    'moisture-flux',
    'stp-fixed',
    'ehi',
    'lapse-rate',
    'ivt',
    'potential-vorticity',
    'q-vector',
    'differential-advection',
    'isentropic',
    'storm-relative',
    'absolute-vorticity',
]);

/**
 * What each diagnostic's inputs are, in order (config lists a field's inputs in this order). Null where the count
 * follows the recipe's params (the profile levels): `diagnosticInputCount` gives it.
 */
export const DIAGNOSTIC_ROLES: Readonly<Record<DiagnosticRecipe, readonly string[] | null>> = {
    advection: ['scalar', 'u', 'v'],
    frontogenesis: ['temperature', 'u', 'v'],
    'moisture-flux': ['specific humidity', 'u', 'v'],
    'stp-fixed': ['sbcape', 'lcl height msl', 'terrain height', 'srh 0-1 km', 'shear u', 'shear v'],
    ehi: ['cape', 'srh'],
    'lapse-rate': ['lower temperature', 'upper temperature', 'lower height', 'upper height'],
    // Per level, in descending pressure: specific humidity (g/kg), u, v; then the surface pressure (hPa).
    ivt: null,
    // Per level, lower to upper: temperature, u, v.
    'potential-vorticity': [
        'lower temperature',
        'lower u',
        'lower v',
        'middle temperature',
        'middle u',
        'middle v',
        'upper temperature',
        'upper u',
        'upper v',
    ],
    'q-vector': ['temperature', 'u', 'v'],
    // Speed, and the direction it blows from in degrees (meteorological, relative to north).
    'absolute-vorticity': ['wind speed', 'wind direction'],
    'differential-advection': [
        'lower temperature',
        'lower u',
        'lower v',
        'upper temperature',
        'upper u',
        'upper v',
    ],
    // Temperature per level, then (humidity | u then v) per level for the output, then the surface pressure (hPa).
    isentropic: null,
    // Terrain height, 10 m u and v, 0-6 km shear u and v, then height, u and v per level.
    'storm-relative': null,
};

const ISENTROPIC_EXTRAS: Readonly<Record<string, number>> = { pressure: 0, humidity: 1, speed: 2 };
const STORM_FIXED_INPUTS = 5;

/** How many inputs a diagnostic with a variable list takes for its params; null for the fixed ones, -1 when the params cannot say. */
export function diagnosticInputCount(
    recipe: ModelRecipe,
    params: ModelRecipeParams | undefined,
): number | null {
    const n = params?.levelsHpa?.length ?? 0;
    if (recipe === 'ivt') return n > 0 ? 3 * n + 1 : -1;
    if (recipe === 'isentropic') {
        const extras = ISENTROPIC_EXTRAS[params?.output ?? ''];
        return n > 0 && extras !== undefined ? n * (1 + extras) + 1 : -1;
    }
    if (recipe === 'storm-relative') return n > 0 ? STORM_FIXED_INPUTS + 3 * n : -1;
    return null;
}

const floats = (g: LevelGrid): Float32Array => Float32Array.from(g.data, fromHalf);

/** east/north components of the grid's winds, rotated in place unless they already are. */
function earthWind(
    grids: readonly LevelGrid[],
    proj: GridProjection,
    params: ModelRecipeParams,
    componentsRelativeToGrid: boolean | undefined,
): { u: Float32Array; v: Float32Array } {
    const u = floats(grids[0]);
    const v = floats(grids[1]);
    const frame = params.frame ?? (componentsRelativeToGrid === false ? 'earth' : 'grid');
    if (frame === 'grid') {
        const { cos, sin } = gridMetrics(proj);
        rotateToEarth(u, v, cos, sin);
    }
    return { u, v };
}

const store = (values: Float32Array): Uint16Array => {
    const data = new Uint16Array(values.length);
    for (let k = 0; k < values.length; k++)
        data[k] = Number.isFinite(values[k]) ? toHalf(values[k]) : HALF_NAN;
    return data;
};

/** Derivatives are taken on the whole grid; a decimated input cannot be differentiated. */
function requireFullGrid(inputs: readonly LevelGrid[], proj: GridProjection): void {
    for (const g of inputs) {
        if (g.factor !== 1 || g.nx !== proj.nx || g.ny !== proj.ny)
            throw new Error('A derivative needs the full-resolution grid');
    }
}

/**
 * Apply a function of the inputs' values at each cell; NaN in any input is NaN out. A profile function says it
 * `tolerates` NaN: a level under the ground may be missing, and the function skips it.
 */
function pointwise(
    inputs: readonly LevelGrid[],
    fn: (v: number[]) => number | null,
    tolerates = false,
): Uint16Array {
    const n = inputs[0].data.length;
    const out = new Uint16Array(n);
    const v = new Array<number>(inputs.length);
    for (let k = 0; k < n; k++) {
        let ok = true;
        for (let a = 0; a < inputs.length; a++) {
            v[a] = fromHalf(inputs[a].data[k]);
            if (Number.isNaN(v[a]) && !tolerates) ok = false;
        }
        const result = ok ? fn(v) : null;
        out[k] = result !== null && Number.isFinite(result) ? toHalf(result) : HALF_NAN;
    }
    return out;
}

/** -V.grad(s), in the scalar's unit per hour. */
function advection(
    scalar: Float32Array,
    u: Float32Array,
    v: Float32Array,
    proj: GridProjection,
): Float32Array {
    const g = gradient(scalar, gridMetrics(proj));
    const out = new Float32Array(scalar.length);
    for (let k = 0; k < out.length; k++) out[k] = -(u[k] * g.east[k] + v[k] * g.north[k]) * SECONDS_PER_HOUR;
    return out;
}

/**
 * 2-D Petterssen kinematic frontogenesis of potential temperature (Keyser et al. 1988), in K per 100 km per 3 h:
 * F = -(1/|grad theta|) [ theta_x^2 u_x + theta_x theta_y (v_x + u_y) + theta_y^2 v_y ]. Zero where theta is uniform.
 */
function frontogenesis(
    theta: Float32Array,
    u: Float32Array,
    v: Float32Array,
    proj: GridProjection,
): Float32Array {
    const m = gridMetrics(proj);
    const t = gradient(theta, m);
    const gu = gradient(u, m);
    const gv = gradient(v, m);
    const out = new Float32Array(theta.length);
    for (let k = 0; k < out.length; k++) {
        const tx = t.east[k],
            ty = t.north[k];
        const magnitude = Math.hypot(tx, ty);
        const bracket = tx * tx * gu.east[k] + tx * ty * (gv.east[k] + gu.north[k]) + ty * ty * gv.north[k];
        out[k] =
            magnitude === 0 ? 0 : (-bracket / magnitude) * FRONTOGENESIS_DISTANCE_M * FRONTOGENESIS_PERIOD_S;
    }
    return out;
}

const levelsOf = (recipe: string, params: ModelRecipeParams, count?: number): readonly number[] => {
    const levels = params.levelsHpa;
    if (!levels || levels.length === 0 || (count !== undefined && levels.length !== count))
        throw new Error(`${recipe} needs recipeParams.levelsHpa${count ? ` with ${count} levels` : ''}`);
    return levels;
};

/** Integrated vapour transport (kg/m/s): |1/g integral of q V dp| from the surface to the top level, trapezoids between levels. */
function ivt(v: readonly number[], levels: readonly number[]): number | null {
    const surface = v[v.length - 1];
    if (!(surface > 0)) return null;
    let sumU = 0;
    let sumV = 0;
    let prev: { p: number; fu: number; fv: number } | null = null;
    for (let k = 0; k < levels.length; k++) {
        const p = levels[k];
        if (p > surface) continue; // below the ground
        const q = v[3 * k] / GRAMS_PER_KG;
        const cur = { p, fu: q * v[3 * k + 1], fv: q * v[3 * k + 2] };
        // From the ground to the lowest level above it the flux is taken as that level's.
        if (prev === null) {
            sumU += (surface - p) * PASCALS_PER_HPA * cur.fu;
            sumV += (surface - p) * PASCALS_PER_HPA * cur.fv;
        } else {
            sumU += 0.5 * (prev.fu + cur.fu) * (prev.p - p) * PASCALS_PER_HPA;
            sumV += 0.5 * (prev.fv + cur.fv) * (prev.p - p) * PASCALS_PER_HPA;
        }
        prev = cur;
    }
    return prev === null ? null : Math.hypot(sumU, sumV) / SOUNDING_GRAVITY;
}

/**
 * Ertel potential vorticity on a pressure level (PVU), baroclinic form (as MetPy):
 * PV = -g [ (zeta + f) d(theta)/dp + du/dp d(theta)/dy - dv/dp d(theta)/dx ], vertical derivatives centred over the
 * levels below and above, horizontal ones on the middle level.
 */
function potentialVorticity(
    t: readonly Float32Array[],
    u: readonly Float32Array[],
    v: readonly Float32Array[],
    levels: readonly number[],
    proj: GridProjection,
): Float32Array {
    const m = gridMetrics(proj);
    const [pLow, , pHigh] = levels;
    const thetas = t.map((tc, i) => tc.map((x) => thetaK(levels[i], x)));
    const dp = (pHigh - pLow) * PASCALS_PER_HPA;
    const th = gradient(thetas[1], m);
    const gu = gradient(u[1], m);
    const gv = gradient(v[1], m);
    const out = new Float32Array(thetas[1].length);
    for (let k = 0; k < out.length; k++) {
        const f = 2 * EARTH_ROTATION_RAD_S * Math.sin((m.lat[k] * Math.PI) / 180);
        const zeta = gv.east[k] - gu.north[k];
        const dthdp = (thetas[2][k] - thetas[0][k]) / dp;
        const dudp = (u[2][k] - u[0][k]) / dp;
        const dvdp = (v[2][k] - v[0][k]) / dp;
        out[k] =
            -SOUNDING_GRAVITY * ((zeta + f) * dthdp + dudp * th.north[k] - dvdp * th.east[k]) * PVU_PER_SI;
    }
    return out;
}

/**
 * Absolute vorticity zeta + f of a wind given as a speed and the direction it blows from. On the sphere
 * zeta = dv/dx - du/dy + u tan(lat) / a, with the derivatives along east and north; f = 2 Omega sin(lat).
 */
function absoluteVorticity(speed: Float32Array, direction: Float32Array, proj: GridProjection): Float32Array {
    const m = gridMetrics(proj);
    const u = new Float32Array(speed.length);
    const v = new Float32Array(speed.length);
    for (let k = 0; k < u.length; k++) {
        const d = (direction[k] * Math.PI) / 180;
        // Calm air has no direction to be missing.
        u[k] = speed[k] === 0 ? 0 : -speed[k] * Math.sin(d);
        v[k] = speed[k] === 0 ? 0 : -speed[k] * Math.cos(d);
    }
    const gu = gradient(u, m);
    const gv = gradient(v, m);
    const out = new Float32Array(u.length);
    for (let k = 0; k < out.length; k++) {
        const lat = (m.lat[k] * Math.PI) / 180;
        const zeta = gv.east[k] - gu.north[k] + (u[k] * Math.tan(lat)) / DERIVATIVE_EARTH_RADIUS_M;
        out[k] = (zeta + 2 * EARTH_ROTATION_RAD_S * Math.sin(lat)) * VORTICITY_STORED_PER_SI;
    }
    return out;
}

/**
 * Q-vector Q = -(R/p) (dV/dx . grad T, dV/dy . grad T) with the model's wind in place of the geostrophic wind, and its
 * convergence -2 div Q (the forcing of ascent in the quasi-geostrophic omega equation).
 */
function qVector(
    temperature: Float32Array,
    u: Float32Array,
    v: Float32Array,
    pHpa: number,
    output: string,
    proj: GridProjection,
): Float32Array {
    const m = gridMetrics(proj);
    const t = gradient(temperature, m);
    const gu = gradient(u, m);
    const gv = gradient(v, m);
    const k0 = -SOUNDING_RD / (pHpa * PASCALS_PER_HPA);
    const q1 = new Float32Array(u.length);
    const q2 = new Float32Array(u.length);
    for (let k = 0; k < u.length; k++) {
        q1[k] = k0 * (gu.east[k] * t.east[k] + gv.east[k] * t.north[k]);
        q2[k] = k0 * (gu.north[k] * t.east[k] + gv.north[k] * t.north[k]);
    }
    const out = new Float32Array(u.length);
    if (output === 'magnitude') {
        for (let k = 0; k < out.length; k++) out[k] = Math.hypot(q1[k], q2[k]) * Q_VECTOR_STORED_PER_SI;
    } else if (output === 'convergence') {
        const d1 = gradient(q1, m);
        const d2 = gradient(q2, m);
        for (let k = 0; k < out.length; k++)
            out[k] =
                -Q_VECTOR_CONVERGENCE_FACTOR *
                (d1.east[k] + d2.north[k]) *
                Q_VECTOR_CONVERGENCE_STORED_PER_SI;
    } else throw new Error('q-vector needs recipeParams.output magnitude or convergence');
    return out;
}

/**
 * A field on an isentropic surface: the lowest crossing of potential temperature `theta` going up the levels, linear in
 * ln p between the two levels that bracket it. Levels below the ground are skipped, and a surface under the ground is missing.
 * `v` is temperature (C) per level, then the output's extras per level, then the surface pressure (hPa).
 */
function isentropic(
    v: readonly number[],
    levels: readonly number[],
    theta: number,
    output: string,
): number | null {
    const n = levels.length;
    const surface = v[v.length - 1];
    if (!(surface > 0)) return null;
    let prev = -1;
    let prevTheta = 0;
    for (let k = 0; k < n; k++) {
        if (levels[k] > surface) continue;
        const th = thetaK(levels[k], v[k]);
        if (prev < 0) {
            if (th > theta) return null;
        } else if (prevTheta <= theta && th >= theta) {
            const w = th > prevTheta ? (theta - prevTheta) / (th - prevTheta) : 0;
            const mix = (a: number, b: number) => a + w * (b - a);
            if (output === 'pressure') return Math.exp(mix(Math.log(levels[prev]), Math.log(levels[k])));
            if (output === 'humidity') return mix(v[n + prev], v[n + k]);
            return Math.hypot(mix(v[n + prev], v[n + k]), mix(v[2 * n + prev], v[2 * n + k]));
        }
        prev = k;
        prevTheta = th;
    }
    return null;
}

/**
 * Speed of the wind at `targetHpa` relative to the Bunkers right mover (m/s). The motion is the 0-6 km AGL mean wind, from
 * the 10 m wind and the levels' winds at their heights above the terrain, deviated 7.5 m/s to the right of the 0-6 km shear
 * (`bunkersDeviate`, the sounding page's own). The model's bulk shear stands in for the 0-0.5 / 5.5-6 km segment shear.
 */
function stormRelativeSpeed(
    v: readonly number[],
    levels: readonly number[],
    targetHpa: number,
): number | null {
    const [terrain, u10, v10, shearU, shearV] = v;
    const z = [0];
    const us = [u10];
    const vs = [v10];
    for (let k = 0; k < levels.length; k++) {
        const height = v[STORM_FIXED_INPUTS + 3 * k] - terrain;
        if (height > z[z.length - 1]) {
            z.push(height);
            us.push(v[STORM_FIXED_INPUTS + 3 * k + 1]);
            vs.push(v[STORM_FIXED_INPUTS + 3 * k + 2]);
        }
    }
    const top = Math.min(STORM_MEAN_DEPTH_M, z[z.length - 1]);
    if (top < STORM_MEAN_MIN_DEPTH_M) return null;
    let su = 0;
    let sv = 0;
    for (let i = 1; i < z.length && z[i - 1] < top; i++) {
        const z1 = Math.min(z[i], top);
        const t = (z1 - z[i - 1]) / (z[i] - z[i - 1]);
        su += 0.5 * (us[i - 1] + us[i - 1] + t * (us[i] - us[i - 1])) * (z1 - z[i - 1]);
        sv += 0.5 * (vs[i - 1] + vs[i - 1] + t * (vs[i] - vs[i - 1])) * (z1 - z[i - 1]);
    }
    const motion = bunkersDeviate({ u: su / top, v: sv / top }, shearU, shearV);
    const index = levels.indexOf(targetHpa);
    if (index < 0) throw new Error('storm-relative needs recipeParams.targetHpa among its levels');
    const target = STORM_FIXED_INPUTS + 3 * index;
    if (!(v[target] - terrain > 0)) return null; // the level is under the ground
    return Math.hypot(v[target + 1] - motion.u, v[target + 2] - motion.v);
}

export function combineDiagnostic(
    recipe: DiagnosticRecipe,
    inputs: LevelGrid[],
    proj: GridProjection,
    params: ModelRecipeParams,
    componentsRelativeToGrid?: boolean,
): { data: Uint16Array; channels: 1 } {
    switch (recipe) {
        case 'advection': {
            requireFullGrid(inputs, proj);
            const { u, v } = earthWind(inputs.slice(1), proj, params, componentsRelativeToGrid);
            return { data: store(advection(floats(inputs[0]), u, v, proj)), channels: 1 };
        }
        case 'frontogenesis': {
            requireFullGrid(inputs, proj);
            if (!(params.levelHpa && params.levelHpa > 0))
                throw new Error('Frontogenesis needs the pressure level of its temperature');
            const { u, v } = earthWind(inputs.slice(1), proj, params, componentsRelativeToGrid);
            const theta = floats(inputs[0]).map((tC) => thetaK(params.levelHpa as number, tC));
            return { data: store(frontogenesis(theta, u, v, proj)), channels: 1 };
        }
        case 'moisture-flux': {
            // The flux's size is the same in either frame, so the winds need no rotation.
            return { data: pointwise(inputs, ([q, u, v]) => q * Math.hypot(u, v)), channels: 1 };
        }
        case 'stp-fixed':
            return {
                data: pointwise(inputs, ([cape, lclMsl, terrain, srh, shearU, shearV]) =>
                    stpFixed(cape, lclMsl - terrain, srh, Math.hypot(shearU, shearV)),
                ),
                channels: 1,
            };
        case 'ehi':
            return { data: pointwise(inputs, ([cape, srh]) => ehi(cape, srh)), channels: 1 };
        case 'lapse-rate':
            // The rate temperature falls with height: positive when it cools upward.
            return {
                data: pointwise(inputs, ([tLow, tHigh, zLow, zHigh]) =>
                    zHigh > zLow ? (tLow - tHigh) / ((zHigh - zLow) / METRES_PER_KM) : null,
                ),
                channels: 1,
            };
        case 'ivt': {
            // The size of a transport is the same in either frame, so the winds need no rotation.
            const levels = levelsOf(recipe, params);
            return { data: pointwise(inputs, (v) => ivt(v, levels), true), channels: 1 };
        }
        case 'potential-vorticity': {
            requireFullGrid(inputs, proj);
            const levels = levelsOf(recipe, params, 3);
            const winds = [0, 1, 2].map((i) =>
                earthWind(inputs.slice(3 * i + 1, 3 * i + 3), proj, params, componentsRelativeToGrid),
            );
            return {
                data: store(
                    potentialVorticity(
                        [0, 1, 2].map((i) => floats(inputs[3 * i])),
                        winds.map((w) => w.u),
                        winds.map((w) => w.v),
                        levels,
                        proj,
                    ),
                ),
                channels: 1,
            };
        }
        case 'absolute-vorticity': {
            requireFullGrid(inputs, proj);
            return {
                data: store(absoluteVorticity(floats(inputs[0]), floats(inputs[1]), proj)),
                channels: 1,
            };
        }
        case 'q-vector': {
            requireFullGrid(inputs, proj);
            if (!(params.levelHpa && params.levelHpa > 0))
                throw new Error('A Q-vector needs the pressure level of its temperature');
            const { u, v } = earthWind(inputs.slice(1), proj, params, componentsRelativeToGrid);
            return {
                data: store(qVector(floats(inputs[0]), u, v, params.levelHpa, params.output ?? '', proj)),
                channels: 1,
            };
        }
        case 'differential-advection': {
            requireFullGrid(inputs, proj);
            const low = earthWind(inputs.slice(1, 3), proj, params, componentsRelativeToGrid);
            const high = earthWind(inputs.slice(4, 6), proj, params, componentsRelativeToGrid);
            const a = advection(floats(inputs[0]), low.u, low.v, proj);
            const b = advection(floats(inputs[3]), high.u, high.v, proj);
            return { data: store(a.map((x, k) => x - b[k])), channels: 1 };
        }
        case 'isentropic': {
            const levels = levelsOf(recipe, params);
            if (!(params.thetaK && params.thetaK > 0))
                throw new Error('An isentropic field needs recipeParams.thetaK');
            const { thetaK: theta, output = '' } = params;
            return {
                data: pointwise(inputs, (v) => isentropic(v, levels, theta, output), true),
                channels: 1,
            };
        }
        case 'storm-relative': {
            // Every vector is in the grid's frame (winds and shear alike) and only a size comes out, so nothing is rotated.
            const levels = levelsOf(recipe, params);
            const target = params.targetHpa ?? 0;
            return {
                data: pointwise(inputs, (v) => stormRelativeSpeed(v, levels, target), true),
                channels: 1,
            };
        }
    }
}
