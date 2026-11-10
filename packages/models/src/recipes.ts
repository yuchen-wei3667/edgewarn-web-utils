import { TtlMap } from './internal/ttl-map.ts';
import { equivalentPotentialTemperature } from '@edgewarn/web-utils/met';
import { HALF_NAN, fromHalf, toHalf, type LevelGrid } from '@edgewarn/web-utils/grib2';
import { PTYPE_CODES } from './catalog.ts';
import type { ModelRecipe, ModelRecipeParams } from './configs/types.ts';
import type { GridProjection } from './projection/types.ts';
import { rotateToEarth, rotationTables } from './winds.ts';
import {
    DIAGNOSTIC_RECIPES,
    DIAGNOSTIC_ROLES,
    combineDiagnostic,
    type DiagnosticRecipe,
} from './diagnosticRecipes.ts';

export interface RecipeOutput {
    /** float16 bits, `channels` interleaved, in level scan order. */
    data: Uint16Array;
    channels: 1 | 2;
}

/**
 * What each input of a recipe is, in order. Config lists a field's inputs in this order, and the
 * registry test holds every field to it. `sum` takes any number of windows.
 */
export const RECIPE_ROLES: Readonly<Record<ModelRecipe, readonly string[] | null>> = {
    single: ['value'],
    vector: ['u', 'v'],
    'speed-direction': ['speed', 'direction'],
    ptype: ['rain', 'snow', 'sleet', 'freezing rain'],
    thetae: ['temperature', 'dewpoint', 'pressure'],
    sum: null,
    ...DIAGNOSTIC_ROLES,
};

/** Rotation tables are pure functions of the level geometry: keep one per level. */
const rotationCache = new TtlMap<string, { cos: Float32Array; sin: Float32Array }>();

function rotationFor(proj: GridProjection, g: LevelGrid) {
    // The projection's key carries its constants: two datasets can share a grid size and differ in the rest.
    const key = `${proj.key}@${g.factor}`;
    let t = rotationCache.get(key);
    if (!t) {
        t = rotationTables(proj, g.nx, g.ny, g.factor);
        rotationCache.set(key, t);
    }
    return t;
}

/** Two float16 grids into interleaved float16 pairs, rotated to east/north first when asked. */
function interleave(
    u: Float32Array,
    v: Float32Array,
    rotate: { cos: Float32Array; sin: Float32Array } | null,
): RecipeOutput {
    if (rotate) rotateToEarth(u, v, rotate.cos, rotate.sin);
    const data = new Uint16Array(u.length * 2);
    for (let k = 0; k < u.length; k++) {
        data[2 * k] = toHalf(u[k]);
        data[2 * k + 1] = toHalf(v[k]);
    }
    return { data, channels: 2 };
}

/**
 * Combine the decoded inputs of one field at one level into what the renderer draws. `params` are the
 * field's recipe options; `proj` is only read to rotate a grid-relative wind.
 */
export function combineInputs(
    recipe: ModelRecipe,
    inputs: LevelGrid[],
    proj: GridProjection,
    params: ModelRecipeParams = {},
    componentsRelativeToGrid?: boolean,
): RecipeOutput {
    const n = inputs[0].nx * inputs[0].ny;
    switch (recipe) {
        case 'single':
            return { data: inputs[0].data, channels: 1 };
        case 'vector': {
            // The field's own `frame` decides; without one the message's component flag does, and a
            // message that does not say is taken as grid-relative.
            const u = Float32Array.from(inputs[0].data, fromHalf);
            const v = Float32Array.from(inputs[1].data, fromHalf);
            const frame = params.frame ?? (componentsRelativeToGrid === false ? 'earth' : 'grid');
            return interleave(u, v, frame === 'earth' ? null : rotationFor(proj, inputs[0]));
        }
        case 'speed-direction': {
            // Speed and the direction it blows FROM (meteorological degrees) become u/v components.
            const speed = inputs[0].data;
            const direction = inputs[1].data;
            const u = new Float32Array(n);
            const v = new Float32Array(n);
            for (let k = 0; k < n; k++) {
                const s = fromHalf(speed[k]);
                const d = (fromHalf(direction[k]) * Math.PI) / 180;
                if (!Number.isFinite(s)) {
                    u[k] = NaN;
                    v[k] = NaN;
                    continue;
                }
                // Calm air has no direction to be missing.
                if (s === 0) {
                    u[k] = 0;
                    v[k] = 0;
                    continue;
                }
                u[k] = -s * Math.sin(d);
                v[k] = -s * Math.cos(d);
            }
            return interleave(u, v, params.frame === 'grid' ? rotationFor(proj, inputs[0]) : null);
        }
        case 'ptype': {
            // Inputs: rain, snow, sleet, freezing rain masks. The most hazardous type present wins.
            const [rain, snow, sleet, frz] = inputs.map((g) => g.data);
            const on = (h: number) => h !== HALF_NAN && fromHalf(h) >= 0.5;
            const data = new Uint16Array(n);
            for (let k = 0; k < n; k++) {
                const code = on(frz[k])
                    ? PTYPE_CODES.freezingRain
                    : on(sleet[k])
                      ? PTYPE_CODES.sleet
                      : on(snow[k])
                        ? PTYPE_CODES.snow
                        : on(rain[k])
                          ? PTYPE_CODES.rain
                          : PTYPE_CODES.none;
                data[k] = code === PTYPE_CODES.none ? HALF_NAN : toHalf(code);
            }
            return { data, channels: 1 };
        }
        case 'thetae': {
            const [t, td, p] = inputs.map((g) => g.data);
            const data = new Uint16Array(n);
            for (let k = 0; k < n; k++) {
                const v = equivalentPotentialTemperature(fromHalf(p[k]), fromHalf(t[k]), fromHalf(td[k]));
                data[k] = Number.isFinite(v) ? toHalf(v) : HALF_NAN;
            }
            return { data, channels: 1 };
        }
        case 'sum': {
            // `sum-window` fields: the component for each consecutive window, added together. A texel
            // with nothing to add stays NaN; partial sums keep the total that is there.
            const data = new Uint16Array(n);
            for (let k = 0; k < n; k++) {
                let total = 0;
                let seen = false;
                for (const g of inputs) {
                    const v = fromHalf(g.data[k]);
                    if (Number.isNaN(v)) continue;
                    seen = true;
                    total += v;
                }
                data[k] = seen ? toHalf(total) : HALF_NAN;
            }
            return { data, channels: 1 };
        }
        case 'advection':
        case 'frontogenesis':
        case 'moisture-flux':
        case 'stp-fixed':
        case 'ehi':
        case 'lapse-rate':
        case 'ivt':
        case 'potential-vorticity':
        case 'q-vector':
        case 'differential-advection':
        case 'isentropic':
        case 'storm-relative':
        case 'absolute-vorticity':
            return combineDiagnostic(
                recipe satisfies DiagnosticRecipe,
                inputs,
                proj,
                params,
                componentsRelativeToGrid,
            );
    }
}

/**
 * Whether a recipe has to run on the full-resolution grid and be decimated afterwards. A direction
 * cannot be averaged across cells (350 and 10 degrees do not average to 180), so a speed and a
 * direction are turned into components first, which can. A derivative does not commute with
 * averaging either, and the composites are nonlinear, so every diagnostic runs at full resolution.
 */
export const combinesBeforeDecimation = (recipe: ModelRecipe): boolean =>
    recipe === 'speed-direction' || DIAGNOSTIC_RECIPES.has(recipe);

/**
 * Box-mean a combined full-resolution grid (`channels` interleaved float16) down by `factor`, the way
 * the decoder's mean level does: NaN cells are left out, an all-NaN block stays NaN, and the last
 * column and row may be partial blocks.
 */
export function decimateMean(
    data: Uint16Array,
    nx: number,
    ny: number,
    channels: number,
    factor: number,
): { data: Uint16Array; nx: number; ny: number } {
    const ox = Math.ceil(nx / factor);
    const oy = Math.ceil(ny / factor);
    const out = new Uint16Array(ox * oy * channels);
    const sums = new Float64Array(channels);
    const cell = new Float64Array(channels);
    for (let r = 0; r < oy; r++) {
        for (let c = 0; c < ox; c++) {
            sums.fill(0);
            let count = 0;
            for (let j = r * factor; j < Math.min(r * factor + factor, ny); j++) {
                for (let i = c * factor; i < Math.min(c * factor + factor, nx); i++) {
                    const base = (j * nx + i) * channels;
                    let valid = true;
                    for (let k = 0; k < channels; k++) {
                        cell[k] = fromHalf(data[base + k]);
                        if (Number.isNaN(cell[k])) valid = false;
                    }
                    if (!valid) continue;
                    for (let k = 0; k < channels; k++) sums[k] += cell[k];
                    count++;
                }
            }
            for (let k = 0; k < channels; k++)
                out[(r * ox + c) * channels + k] = count ? toHalf(sums[k] / count) : HALF_NAN;
        }
    }
    return { data: out, nx: ox, ny: oy };
}
