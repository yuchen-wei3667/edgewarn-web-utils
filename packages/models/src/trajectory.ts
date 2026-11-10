import { DERIVATIVE_EARTH_RADIUS_M, TRAJECTORY_STEP_S } from './limits.ts';
import type { GridProjection } from './projection/types.ts';

/**
 * Parcel trajectories through a model's wind (phase 5.10). A trajectory is not a gridded field, so it is not a recipe:
 * the caller reads the wind of one or more frames, hands over samplers, and gets the path back as points, the way the
 * HAFS storm tracks (`tracks/`) are. Fourth-order Runge-Kutta on the sphere, forward or backward in time, over the
 * wind at one pressure level (a horizontal, isobaric trajectory; vertical motion is not followed).
 */

export interface TrajectoryPoint {
    /** Seconds from the start; negative for a backward trajectory. */
    seconds: number;
    lat: number;
    /** Degrees east, -180..180. */
    lon: number;
}

/** East and north wind (m/s) at a place and a time (seconds from the start), or null where the model has none. */
export type WindSampler = (lat: number, lon: number, seconds: number) => { u: number; v: number } | null;

export interface TrajectoryOptions {
    /** Length of the trajectory, seconds, positive. */
    durationS: number;
    direction: 'forward' | 'backward';
    /** Integration step, seconds. */
    stepS?: number;
}

const D2R = Math.PI / 180;
const wrap180 = (lon: number): number => ((((lon + 180) % 360) + 360) % 360) - 180;

/** Rate of change of latitude and longitude, radians per second, of a parcel moving with (u, v) at `lat`. */
function angularRates(lat: number, wind: { u: number; v: number }): [number, number] {
    return [wind.v / DERIVATIVE_EARTH_RADIUS_M, wind.u / (DERIVATIVE_EARTH_RADIUS_M * Math.cos(lat * D2R))];
}

/**
 * The path of a parcel released at (lat, lon). The first point is the start; the path ends early, without a final point, where
 * the wind is missing or the parcel reaches a pole.
 */
export function integrateTrajectory(
    start: { lat: number; lon: number },
    wind: WindSampler,
    options: TrajectoryOptions,
): TrajectoryPoint[] {
    const sign = options.direction === 'forward' ? 1 : -1;
    const step = options.stepS ?? TRAJECTORY_STEP_S;
    const points: TrajectoryPoint[] = [{ seconds: 0, lat: start.lat, lon: wrap180(start.lon) }];
    let lat = start.lat;
    let lon = start.lon;
    const rate = (la: number, lo: number, s: number): [number, number] | null => {
        const w = wind(la, wrap180(lo), s);
        if (!w || !Number.isFinite(w.u) || !Number.isFinite(w.v) || Math.abs(la) >= 90) return null;
        const [dLat, dLon] = angularRates(la, w);
        return [(sign * dLat) / D2R, (sign * dLon) / D2R];
    };
    const steps = Math.ceil(options.durationS / step);
    for (let n = 0; n < steps; n++) {
        const t = n * step;
        const h = Math.min(step, options.durationS - t);
        const s0 = sign * t;
        const k1 = rate(lat, lon, s0);
        const k2 = k1 && rate(lat + 0.5 * h * k1[0], lon + 0.5 * h * k1[1], s0 + sign * 0.5 * h);
        const k3 = k2 && rate(lat + 0.5 * h * k2[0], lon + 0.5 * h * k2[1], s0 + sign * 0.5 * h);
        const k4 = k3 && rate(lat + h * k3[0], lon + h * k3[1], s0 + sign * h);
        if (!k1 || !k2 || !k3 || !k4) break;
        lat += (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
        lon += (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
        if (Math.abs(lat) >= 90) break;
        points.push({ seconds: sign * (t + h), lat, lon: wrap180(lon) });
    }
    return points;
}

/** Bilinear sampler of east/north wind grids (full resolution, the grid's cell order) on the grid's projection; null outside it or on a missing cell. */
export function gridWindSampler(
    proj: GridProjection,
    east: Float32Array,
    north: Float32Array,
): (lat: number, lon: number) => { u: number; v: number } | null {
    const { nx, ny } = proj;
    return (lat, lon) => {
        const [x, y] = proj.forward(lat, lon);
        const i = Math.floor(x);
        const j = Math.floor(y);
        if (!(i >= 0 && j >= 0 && i + 1 < nx && j + 1 < ny)) return null;
        const fx = x - i;
        const fy = y - j;
        let u = 0;
        let v = 0;
        for (const [di, dj, w] of [
            [0, 0, (1 - fx) * (1 - fy)],
            [1, 0, fx * (1 - fy)],
            [0, 1, (1 - fx) * fy],
            [1, 1, fx * fy],
        ] as const) {
            const k = (j + dj) * nx + i + di;
            u += w * east[k];
            v += w * north[k];
        }
        return Number.isFinite(u) && Number.isFinite(v) ? { u, v } : null;
    };
}

/** A sampler that blends the wind of frames in time: `times` are seconds from the start, ascending, one per sampler; outside them the nearest frame holds. */
export function blendInTime(
    times: readonly number[],
    samplers: readonly ((lat: number, lon: number) => { u: number; v: number } | null)[],
): WindSampler {
    return (lat, lon, seconds) => {
        let hi = times.findIndex((t) => t >= seconds);
        if (hi < 0) hi = times.length - 1;
        const lo = Math.max(0, hi - 1);
        const a = samplers[lo](lat, lon);
        const b = samplers[hi](lat, lon);
        if (!a || !b) return null;
        const w =
            hi === lo || times[hi] === times[lo]
                ? 0
                : Math.min(1, Math.max(0, (seconds - times[lo]) / (times[hi] - times[lo])));
        return { u: a.u + w * (b.u - a.u), v: a.v + w * (b.v - a.v) };
    };
}
