import type { Colormap } from './types.ts';
import { isValidRgb } from './rgba.ts';

/** One colour stop along a legend bar, `percent` from the left (0-100; an interpolated scale may run past either end). */
export interface ColormapStop {
    rgb: [number, number, number];
    percent: number;
}

/**
 * The colour stops a legend bar draws, left to right: interpolated scales get one stop per threshold, stepped
 * scales a pair per block so the edges stay hard. Shared by CSS legends and colorbar renderers.
 * A scale with no span returns its first colour across the whole bar.
 */
export function colormapStops(colormap: Colormap | null): ColormapStop[] {
    if (!colormap) return [];

    const thresholds = colormap.thresholds.filter((threshold) => isValidRgb(threshold.rgb));
    const { range, interpolate, uniformBlocks } = colormap;
    if (thresholds.length === 0) return [];

    const [minVal, maxVal] = range;
    const rangeSpan = maxVal - minVal;
    if (rangeSpan <= 0) {
        return [
            { rgb: thresholds[0].rgb, percent: 0 },
            { rgb: thresholds[0].rgb, percent: 100 },
        ];
    }

    if (interpolate) {
        return thresholds.map((threshold) => ({
            rgb: threshold.rgb,
            percent: ((threshold.value - minVal) / rangeSpan) * 100,
        }));
    }

    const stops: ColormapStop[] = [];
    if (uniformBlocks) {
        const blockWidth = 100 / thresholds.length;
        thresholds.forEach((threshold, index) => {
            stops.push({ rgb: threshold.rgb, percent: index * blockWidth });
            stops.push({ rgb: threshold.rgb, percent: (index + 1) * blockWidth });
        });
        return stops;
    }

    for (let index = 0; index < thresholds.length; index += 1) {
        const threshold = thresholds[index];
        const start = ((threshold.value - minVal) / rangeSpan) * 100;
        const end =
            index < thresholds.length - 1 ? ((thresholds[index + 1].value - minVal) / rangeSpan) * 100 : 100;
        stops.push({ rgb: threshold.rgb, percent: start });
        stops.push({ rgb: threshold.rgb, percent: end });
    }
    return stops;
}

export interface ColormapTick {
    value: number;
    percent: number;
}

export function getColormapTicks(colormap: Colormap | null, targetTickCount = 10): ColormapTick[] {
    if (!colormap) return [];

    const { range, uniformBlocks, thresholds } = colormap;
    const [minVal, maxVal] = range;
    const rangeSpan = maxVal - minVal;

    if (uniformBlocks && thresholds.length > 0) {
        const blockWidth = 100 / thresholds.length;
        return thresholds.map((threshold, index) => ({
            value: threshold.value,
            percent: index * blockWidth,
        }));
    }

    if (rangeSpan <= 0) {
        return [{ value: minVal, percent: 0 }];
    }

    const rawStep = rangeSpan / Math.max(targetTickCount, 1);
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const residual = rawStep / magnitude;

    let step: number;
    if (residual > 5) step = 10 * magnitude;
    else if (residual > 2) step = 5 * magnitude;
    else if (residual > 1) step = 2 * magnitude;
    else step = magnitude;

    const ticks: ColormapTick[] = [];
    let currentValue = Math.ceil(minVal / step) * step;

    if (Math.abs(minVal - currentValue) < step * 0.01) {
        currentValue = minVal;
    }

    while (currentValue <= maxVal + step * 0.01) {
        ticks.push({
            value: currentValue,
            percent: ((currentValue - minVal) / rangeSpan) * 100,
        });
        currentValue += step;
    }

    return ticks;
}

/** Keeps at most `maxTicks` labels by taking every nth tick, starting from the first. */
export function thinColormapTicks(ticks: ColormapTick[], maxTicks: number): ColormapTick[] {
    if (ticks.length <= maxTicks) return ticks;
    const stride = Math.ceil(ticks.length / Math.max(maxTicks, 1));
    return ticks.filter((_, index) => index % stride === 0);
}

export function formatLegendValue(value: number): string {
    return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}
