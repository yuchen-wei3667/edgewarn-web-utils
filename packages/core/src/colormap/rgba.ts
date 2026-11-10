import type { Colormap } from './types.ts';

/** Colormap evaluation shared by the model and radar layers: value -> RGBA, colormap textures, lookup by key. */

export function isValidRgb(rgb: unknown): rgb is [number, number, number] {
    return (
        Array.isArray(rgb) &&
        rgb.length >= 3 &&
        Number.isFinite(rgb[0]) &&
        Number.isFinite(rgb[1]) &&
        Number.isFinite(rgb[2])
    );
}

function getThresholdAlpha(threshold: { alpha?: number }): number {
    const alpha = threshold.alpha;
    if (typeof alpha !== 'number' || !Number.isFinite(alpha)) return 255;
    return Math.max(0, Math.min(255, Math.round(alpha)));
}

function lerp(start: number, end: number, t: number): number {
    return start + (end - start) * t;
}

function interpolateRgb(
    a: [number, number, number],
    b: [number, number, number],
    t: number,
): [number, number, number] {
    return [
        Math.round(lerp(a[0], b[0], t)),
        Math.round(lerp(a[1], b[1], t)),
        Math.round(lerp(a[2], b[2], t)),
    ];
}

function interpolateAlpha(start: number, end: number, t: number): number {
    return Math.round(lerp(start, end, t));
}

function resolveInterpolatedAlpha(
    value: number,
    lowerValue: number,
    upperValue: number,
    lowerAlpha: number,
    upperAlpha: number,
): number {
    if (lowerAlpha === 0 && upperAlpha === 0) {
        return 0;
    }

    // Treat transparent thresholds as exact transparent stops, not full transparent bands
    // spanning to the next opaque threshold.
    if (lowerAlpha === 0 && upperAlpha > 0) {
        return value <= lowerValue ? 0 : upperAlpha;
    }

    if (upperAlpha === 0 && lowerAlpha > 0) {
        return value >= upperValue ? 0 : lowerAlpha;
    }

    return interpolateAlpha(
        lowerAlpha,
        upperAlpha,
        (value - lowerValue) / Math.max(upperValue - lowerValue, 1),
    );
}

export function mapValueToRgba(
    value: number,
    colormap: Colormap | null,
    range: [number, number],
): [number, number, number, number] {
    const [min, max] = range;
    if (colormap === null) {
        const span = max - min || 1;
        const clamped = Math.max(0, Math.min(1, (value - min) / span));
        const gray = Math.round(lerp(32, 240, clamped));
        return [gray, gray, gray, 255];
    }

    const thresholds = colormap.thresholds.filter((threshold) => isValidRgb(threshold.rgb));
    if (thresholds.length === 0) {
        const span = max - min || 1;
        const clamped = Math.max(0, Math.min(1, (value - min) / span));
        const gray = Math.round(lerp(32, 240, clamped));
        return [gray, gray, gray, 255];
    }

    if (!colormap.interpolate) {
        let match = thresholds[0].rgb;
        let matchAlpha = getThresholdAlpha(thresholds[0]);
        for (const threshold of thresholds) {
            if (value >= threshold.value) {
                match = threshold.rgb;
                matchAlpha = getThresholdAlpha(threshold);
            } else {
                break;
            }
        }
        return [match[0], match[1], match[2], matchAlpha];
    }

    if (value <= thresholds[0].value) {
        const rgb = thresholds[0].rgb;
        return [rgb[0], rgb[1], rgb[2], getThresholdAlpha(thresholds[0])];
    }
    if (value >= thresholds[thresholds.length - 1].value) {
        const rgb = thresholds[thresholds.length - 1].rgb;
        return [rgb[0], rgb[1], rgb[2], getThresholdAlpha(thresholds[thresholds.length - 1])];
    }

    for (let index = 0; index < thresholds.length - 1; index += 1) {
        const lower = thresholds[index];
        const upper = thresholds[index + 1];
        if (value >= lower.value && value <= upper.value) {
            const span = upper.value - lower.value || 1;
            const t = (value - lower.value) / span;
            const rgb = interpolateRgb(lower.rgb, upper.rgb, t);
            const alpha = colormap.interpolateAlpha
                ? interpolateAlpha(getThresholdAlpha(lower), getThresholdAlpha(upper), t)
                : resolveInterpolatedAlpha(
                      value,
                      lower.value,
                      upper.value,
                      getThresholdAlpha(lower),
                      getThresholdAlpha(upper),
                  );
            return [rgb[0], rgb[1], rgb[2], alpha];
        }
    }

    const fallback = thresholds[thresholds.length - 1].rgb;
    return [fallback[0], fallback[1], fallback[2], getThresholdAlpha(thresholds[thresholds.length - 1])];
}

/** RGBA bytes for `size` evenly spaced values across `range` (a 1D colormap texture). */
export function createColormapTextureData(
    colormap: Colormap,
    range: [number, number],
    size: number,
): Uint8Array {
    const data = new Uint8Array(size * 4);
    const [min, max] = range;
    const span = max - min || 1;

    for (let i = 0; i < size; i += 1) {
        const t = size === 1 ? 0 : i / (size - 1);
        const value = min + t * span;
        const [r, g, b, a] = mapValueToRgba(value, colormap, range);
        const offset = i * 4;
        data[offset] = r;
        data[offset + 1] = g;
        data[offset + 2] = b;
        data[offset + 3] = a;
    }

    return data;
}

export function normalizeColormapKey(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function findColormapByKey(colormaps: Colormap[], key: string): Colormap | null {
    const exact = colormaps.find((colormap) => colormap.name === key || colormap.type === key);
    if (exact) return exact;

    const normalized = normalizeColormapKey(key);
    if (!normalized) return null;

    return (
        colormaps.find((colormap) => {
            const byName = normalizeColormapKey(colormap.name);
            const byType = normalizeColormapKey(colormap.type);
            return byName === normalized || byType === normalized;
        }) ?? null
    );
}
