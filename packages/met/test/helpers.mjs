/**
 * Synthetic sounding fixtures shared by the `tests/sounding/` files. Pure maths only, no fetch and
 * no UI; the geometry is fixed so the analytic values are hand-checkable: pressure levels
 * 1000-200 hPa, heights at a strict 10 m per hPa (so 6000 m AGL is exactly 400 hPa), and the
 * standard index levels 850/700/500 are nodes of the grid.
 */

import { tempAtMixratioC } from '@edgewarn/web-utils/met';

/** Standard levels, descending. `levelOf` uses the array index, not a formula. */
export const LEVELS = [
    1000, 975, 950, 925, 900, 875, 850, 825, 800, 775, 750, 725, 700, 675, 650,
    625, 600, 575, 550, 525, 500, 450, 400, 350, 300, 250, 200,
];

/** Height MSL (m) of a level: geometric, 10 m per hPa. The surface row is z = 0. */
export const HEIGHT_OF = (pHpa) => (1000 - pHpa) * 10;

/** Temperature (°C) of a dry lapse `lapse` in K m⁻¹ from a 30 °C surface. */
export const lapseTempOf = (pHpa, lapseKm = 6.5) => 30 - (lapseKm / 1000) * HEIGHT_OF(pHpa);

/** A `Column` for the synthetic geometry; u/v default to 0. NaN rows stay where given. */
export function mkCol(p, t, td, u = null, v = null) {
    return {
        validMs: 0,
        p: Float32Array.from(p),
        z: Float32Array.from(p.map(HEIGHT_OF)),
        t: Float32Array.from(t),
        td: Float32Array.from(td),
        u: Float32Array.from(u ?? p.map(() => 0)),
        v: Float32Array.from(v ?? p.map(() => 0)),
        surface: { p: p[0], z: 0, t: t[0], td: td[0], u: u?.[0] ?? 0, v: v?.[0] ?? 0 },
    };
}

/** Full standard level list helper. */
export const eachLevel = (fn) => LEVELS.map((pHpa, i) => fn(pHpa, i));

/**
 * The unstable profile: a mixed 305 K boundary layer to 850 hPa, 7 K/km above, nearly saturated
 * in the lowest 150 hPa (td = t − 1) with the mixing ratio decaying at 5 K/km of dewpoint above:
 * a warm, deep, weakly capped environment.
 */
export function unstableColumn(u = null, v = null) {
    const td = eachLevel((pHpa) => {
        const t = thetaTemp(pHpa);
        if (pHpa >= 900) return t - 1;
        const zMsl = HEIGHT_OF(pHpa);
        const t900 = thetaTemp(900);
        return (t900 - 1) - 0.005 * (zMsl - HEIGHT_OF(900));
    });
    return mkCol(LEVELS, eachLevel(thetaTemp), td, u, v);
    function thetaTemp(pHpa) {
        if (pHpa >= 850) return 305 * (pHpa / 1000) ** 0.28571426 - 273.15;
        const t850 = 305 * 0.85 ** 0.28571426 - 273.15;
        return t850 - 0.007 * (HEIGHT_OF(pHpa) - HEIGHT_OF(850));
    }
}

/** The stable profile: 3 K/km lapse (stable even to dry parcels) and bone-dry air (td = −40 °C). */
export function stableColumn(u = null, v = null) {
    const t = LEVELS.map((pHpa) => lapseTempOf(pHpa, 3));
    return mkCol(LEVELS, t, LEVELS.map(() => -40), u, v);
}

/** The moist fixed-level-index profile: 6.5 K/km lapse with td = t − 3. */
export function moistIndexColumn() {
    const t = LEVELS.map((pHpa) => lapseTempOf(pHpa));
    return mkCol(LEVELS, t, t.map((v) => v - 3));
}

/** The mixed-layer profile: constant θ and mixing ratio through the lowest 300 hPa. */
export function mixedColumn(mixingRatioGkg = 12) {
    const t = LEVELS.map(thetaTemp);
    const td = LEVELS.map((pHpa) => tempAtMixratioC(mixingRatioGkg, pHpa));
    return mkCol(LEVELS, t, td);
    function thetaTemp(pHpa) {
        return 305 * (pHpa / 1000) ** 0.28571426 - 273.15;
    }
}

/* --- Hodographs --- */

/** Uniform wind everywhere: zero shear and zero SRH for any storm motion. */
export function uniformWinds() {
    return [LEVELS.map(() => 10), LEVELS.map(() => 5)];
}

/** Straight linear hodograph through the origin at 5 m/s per km of height. */
export function straightWinds() {
    return [LEVELS.map((pHpa) => 0.005 * HEIGHT_OF(pHpa)), LEVELS.map(() => 0)];
}

/** Circle hodograph of radius 20 m/s for the lowest 3 km centred on (0, 20), straight above. */
export function circleWinds() {
    const k = (2 * Math.PI) / 3000;
    const curve = (pHpa) => Math.min(HEIGHT_OF(pHpa), 3000);
    return [
        LEVELS.map((pHpa) => 20 * Math.sin(k * curve(pHpa))),
        LEVELS.map((pHpa) => 20 * (1 - Math.cos(k * curve(pHpa)))),
    ];
}

/* --- assertion helpers --- */

/** Deterministic 32-bit LCG in [0, 1). */
export function lcg(seed) {
    let s = seed >>> 0;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 2 ** 32;
    };
}

/** Throws when a non-finite number (NaN/±Infinity) hides anywhere in the object. */
export function assertAllFinite(value, path = 'root') {
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new Error(`non-finite ${value} at ${path}`);
    } else if (typeof value === 'object' && value !== null) {
        for (const [k, v] of Object.entries(value)) assertAllFinite(v, `${path}.${k}`);
    }
}
