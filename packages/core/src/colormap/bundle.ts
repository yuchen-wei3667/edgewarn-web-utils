/** Parser that normalizes a colormap payload (flat list or grouped by product) into `Colormap[]`. */

import type { Colormap } from './types.ts';

interface GroupedColormapResponse {
    source: string;
    product: string;
    version: string;
    colormaps: Colormap[];
}

function isColormap(value: unknown): value is Colormap {
    if (!value || typeof value !== 'object') return false;

    const candidate = value as Partial<Colormap>;

    return (
        typeof candidate.name === 'string' &&
        typeof candidate.description === 'string' &&
        typeof candidate.type === 'string' &&
        typeof candidate.units === 'string' &&
        typeof candidate.interpolate === 'boolean' &&
        Array.isArray(candidate.range) &&
        candidate.range.length === 2 &&
        Array.isArray(candidate.thresholds)
    );
}

function normalizeRgb(rgb: unknown): [number, number, number] | null {
    if (!Array.isArray(rgb) || rgb.length < 3) return null;
    const r = Number(rgb[0]);
    const g = Number(rgb[1]);
    const b = Number(rgb[2]);
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
        return null;
    }
    return [Math.round(r), Math.round(g), Math.round(b)];
}

function getThresholdRgb(threshold: { rgb?: unknown; rgba?: unknown }): [number, number, number] | null {
    return normalizeRgb(threshold.rgb) ?? normalizeRgb(threshold.rgba);
}

function getThresholdAlpha(threshold: { rgba?: unknown }): number | undefined {
    if (!Array.isArray(threshold.rgba) || threshold.rgba.length < 4) {
        return undefined;
    }

    const alpha = Number(threshold.rgba[3]);
    return Number.isFinite(alpha) ? Math.max(0, Math.min(255, Math.round(alpha))) : undefined;
}

function normalizeColormap(colormap: Colormap): Colormap | null {
    const thresholds = colormap.thresholds.flatMap((threshold) => {
        if (!threshold || typeof threshold !== 'object') return [];
        const value = Number((threshold as { value?: unknown }).value);
        const typedThreshold = threshold as { rgb?: unknown; rgba?: unknown };
        const rgb = getThresholdRgb(typedThreshold);
        const alpha = getThresholdAlpha(typedThreshold);
        if (!Number.isFinite(value) || rgb === null) return [];
        return [{ value, rgb, ...(alpha !== undefined ? { alpha } : {}) }];
    });

    if (thresholds.length === 0) {
        return null;
    }

    return {
        ...colormap,
        thresholds,
    };
}

export function extractColormaps(payload: unknown): Colormap[] {
    if (Array.isArray(payload)) {
        if (payload.every(isColormap)) {
            return payload.flatMap((colormap) => {
                const normalized = normalizeColormap(colormap);
                return normalized ? [normalized] : [];
            });
        }

        return payload.flatMap((entry) => {
            if (!entry || typeof entry !== 'object') return [];

            const groupedColormaps = (entry as Partial<GroupedColormapResponse>).colormaps;
            return Array.isArray(groupedColormaps)
                ? groupedColormaps.filter(isColormap).flatMap((colormap) => {
                      const normalized = normalizeColormap(colormap);
                      return normalized ? [normalized] : [];
                  })
                : [];
        });
    }

    if (payload && typeof payload === 'object') {
        const groupedColormaps = (payload as Partial<GroupedColormapResponse>).colormaps;
        if (Array.isArray(groupedColormaps)) {
            return groupedColormaps.filter(isColormap).flatMap((colormap) => {
                const normalized = normalizeColormap(colormap);
                return normalized ? [normalized] : [];
            });
        }
    }

    return [];
}
