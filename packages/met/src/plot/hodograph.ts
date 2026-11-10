import { fieldAt, pressureAtAgl } from '../interp.ts';
import type { Column, SoundingAnalysis, StormMotion, Vec2 } from '../types.ts';
import { componentsFromWind, windFromComponents } from '../wind.ts';
import { SOUNDING_HODOGRAPH, SOUNDING_HODOGRAPH_LAYER_BOUNDS_M } from './constants.ts';
import type { Pt } from './skew-t.ts';

/**
 * Hodograph geometry (phase 5.4): wind components to viewBox units with north up, speed rings, the trace cut into the
 * height layers that colour it, the storm-relative helicity area, and the markers for the storm motions and the mean wind.
 * Pure; nothing here knows a colour or a size. The origin is the centre of the frame.
 */

export interface HodographOptions {
    size?: number;
    maxSpeedMs?: number;
    ringStepMs?: number;
}

/** @public */
export interface Hodograph {
    size: number;
    maxSpeedMs: number;
    ringStepMs: number;
    /** Viewbox units per m/s. */
    scale: number;
    point(u: number, v: number): Pt;
    /** Back from viewBox units to components (m/s), for a drag. */
    invert(x: number, y: number): Vec2;
}

export function createHodograph(options: HodographOptions = {}): Hodograph {
    const { size, maxSpeedMs, ringStepMs } = { ...SOUNDING_HODOGRAPH, ...options };
    const scale = size / 2 / maxSpeedMs;
    const centre = size / 2;
    return {
        size, maxSpeedMs, ringStepMs, scale,
        point: (u, v) => ({ x: centre + u * scale, y: centre - v * scale }),
        invert: (x, y) => ({ u: (x - centre) / scale, v: (centre - y) / scale }),
    };
}

/** Speed rings: radius in viewBox units for every `ringStepMs` out to the largest that fits. */
export function hodographRings(hodograph: Hodograph): { speedMs: number; r: number }[] {
    const rings: { speedMs: number; r: number }[] = [];
    for (let speedMs = hodograph.ringStepMs; speedMs <= hodograph.maxSpeedMs; speedMs += hodograph.ringStepMs) rings.push({ speedMs, r: speedMs * hodograph.scale });
    return rings;
}

/** Which colour layer a height AGL falls in (a layer includes its lower bound), or null at or above the top bound or below ground. */
export function hodographLayerIndex(zAglM: number, bounds: readonly number[] = SOUNDING_HODOGRAPH_LAYER_BOUNDS_M): number | null {
    if (!(zAglM >= bounds[0]) || zAglM >= bounds[bounds.length - 1]) return null;
    let layer = 0;
    while (zAglM >= bounds[layer + 1]) layer++;
    return layer;
}

/** @public */
export interface HodographSegment {
    /** Index into the layer bounds: the layer's colour. */
    layer: number;
    /** Heights AGL of its two ends, m. */
    fromM: number;
    toM: number;
    points: (Pt & { zAglM: number })[];
}

interface WindSample { zAglM: number; u: number; v: number }

/** The column's winds as samples in height order: every level, plus a point on each layer boundary the profile crosses. */
function windSamples(col: Column, topM: number, bounds: readonly number[] = SOUNDING_HODOGRAPH_LAYER_BOUNDS_M): WindSample[] {
    const samples: WindSample[] = [];
    for (let k = 0; k < col.p.length; k++) {
        const zAglM = col.z[k] - col.z[0];
        if (Number.isFinite(zAglM) && zAglM <= topM && Number.isFinite(col.u[k]) && Number.isFinite(col.v[k])) samples.push({ zAglM, u: col.u[k], v: col.v[k] });
    }
    const top = samples.length ? samples[samples.length - 1].zAglM : -1;
    for (const bound of bounds) {
        if (bound <= 0 || bound >= top || samples.some((s) => s.zAglM === bound)) continue;
        const p = pressureAtAgl(col, bound);
        const u = fieldAt(col, 'u', p);
        const v = fieldAt(col, 'v', p);
        if (Number.isFinite(u) && Number.isFinite(v)) samples.push({ zAglM: bound, u, v });
    }
    return samples.sort((a, b) => a.zAglM - b.zAglM);
}

/**
 * The hodograph trace cut into layers: one segment per layer the profile reaches, each starting exactly where the one below
 * ends, so the coloured pieces join. Winds are the column's own levels, not resampled.
 */
export function hodographSegments(
    hodograph: Hodograph, col: Column, bounds: readonly number[] = SOUNDING_HODOGRAPH_LAYER_BOUNDS_M,
): HodographSegment[] {
    const samples = windSamples(col, bounds[bounds.length - 1], bounds);
    const segments: HodographSegment[] = [];
    for (let k = 1; k < samples.length; k++) {
        const a = samples[k - 1];
        const b = samples[k];
        const layer = hodographLayerIndex((a.zAglM + b.zAglM) / 2, bounds);
        if (layer === null) continue;
        const last = segments[segments.length - 1];
        if (last && last.layer === layer && last.toM === a.zAglM) {
            last.points.push({ ...hodograph.point(b.u, b.v), zAglM: b.zAglM });
            last.toM = b.zAglM;
        } else {
            segments.push({
                layer, fromM: a.zAglM, toM: b.zAglM,
                points: [{ ...hodograph.point(a.u, a.v), zAglM: a.zAglM }, { ...hodograph.point(b.u, b.v), zAglM: b.zAglM }],
            });
        }
    }
    return segments;
}

/** The point of the trace at a pressure (for the crosshair shared with the Skew-T); null outside the profile. */
export function hodographPointAtPressure(hodograph: Hodograph, col: Column, pHpa: number): Pt | null {
    const u = fieldAt(col, 'u', pHpa);
    const v = fieldAt(col, 'v', pHpa);
    return Number.isFinite(u) && Number.isFinite(v) ? hodograph.point(u, v) : null;
}

/**
 * The area the helicity of a layer is the (doubled) signed area of: from the storm motion out along the trace between two
 * heights AGL and back. Closed implicitly; empty when the layer leaves the profile.
 */
export function helicityArea(hodograph: Hodograph, col: Column, storm: Vec2, lowerM: number, upperM: number): Pt[] {
    const inside = windSamples(col, upperM).filter((s) => s.zAglM >= lowerM);
    const edge = (zAglM: number): WindSample | null => {
        const p = pressureAtAgl(col, zAglM);
        const u = fieldAt(col, 'u', p);
        const v = fieldAt(col, 'v', p);
        return Number.isFinite(u) && Number.isFinite(v) ? { zAglM, u, v } : null;
    };
    const lower = inside.find((s) => s.zAglM === lowerM) ?? edge(lowerM);
    const upper = inside.find((s) => s.zAglM === upperM) ?? edge(upperM);
    if (!lower || !upper) return [];
    const trace = [lower, ...inside.filter((s) => s.zAglM > lowerM && s.zAglM < upperM), upper];
    return [hodograph.point(storm.u, storm.v), ...trace.map((s) => hodograph.point(s.u, s.v))];
}

export type HodographMarkerKind = 'right-mover' | 'left-mover' | 'mean-wind' | 'storm';

/** @public */
export interface HodographMarker extends Pt {
    kind: HodographMarkerKind;
    u: number;
    v: number;
    speedMs: number;
    /** Direction the motion is FROM, degrees. */
    dirDeg: number;
}

/** Bunkers right and left movers, the 0-6 km mean wind and the storm motion the page is using; a motion the sounding cannot give is left out. */
export function hodographMarkers(hodograph: Hodograph, analysis: SoundingAnalysis): HodographMarker[] {
    const { bunkersRight, bunkersLeft, meanWind06, stormMotion } = analysis.kinematics;
    const wanted: [HodographMarkerKind, Vec2 | null][] = [['right-mover', bunkersRight], ['left-mover', bunkersLeft], ['mean-wind', meanWind06], ['storm', stormMotion]];
    return wanted.flatMap(([kind, vec]) => (vec ? [{ kind, ...vec, ...hodograph.point(vec.u, vec.v), ...windFromComponents(vec.u, vec.v) }] : []));
}

/** A storm motion dragged to a point of the hodograph, as the `user` motion the URL and the analysis carry. */
export function stormMotionAtPoint(hodograph: Hodograph, x: number, y: number): Extract<StormMotion, { kind: 'user' }> {
    const { u, v } = hodograph.invert(x, y);
    const { speedMs, dirDeg } = windFromComponents(u, v);
    return { kind: 'user', dirDeg, speedMs };
}

/** The hodograph point of a user storm motion (the draggable handle's position). */
export function pointOfStormMotion(hodograph: Hodograph, motion: Extract<StormMotion, { kind: 'user' }>): Pt {
    const { u, v } = componentsFromWind(motion.dirDeg, motion.speedMs);
    return hodograph.point(u, v);
}
