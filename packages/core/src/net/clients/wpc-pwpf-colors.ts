import type { SnowThreshold } from './wpc-pwpf-constants.ts';

const SNOW_PROB_COLORS: Record<SnowThreshold, string> = {
    '04': '#63a4ff',
    '08': '#1976d2',
    '12': '#311b92',
};

const PROB_COLORS: Record<number, string> = {
    10: '#e3f2fd',
    20: '#bbdefb',
    30: '#90caf9',
    40: '#64b5f6',
    50: '#42a5f5',
    60: '#1e88e5',
    70: '#1976d2',
    80: '#1565c0',
    90: '#0d47a1',
    100: '#0d47a1',
};

const ICE_PROB_COLORS: Record<number, string> = {
    10: '#fce4ec',
    20: '#f8bbd0',
    30: '#f48fb1',
    40: '#f06292',
    50: '#ec407a',
    60: '#e91e63',
    70: '#d81b60',
    80: '#c2185b',
    90: '#ad1457',
    100: '#880e4f',
};

export function getSnowProbabilityColor(probability: number): string {
    const rounded = Math.floor(probability / 10) * 10;
    const lookup = Math.max(10, Math.min(100, rounded));
    return PROB_COLORS[lookup] || '#90caf9';
}

export function getSnowProbColor(threshold: string): string {
    return SNOW_PROB_COLORS[threshold as SnowThreshold] || '#999999';
}

export function getSnowThresholdLabel(threshold: string): string {
    const labels: Record<SnowThreshold, string> = {
        '04': '> 4"',
        '08': '> 8"',
        '12': '> 12"',
    };

    return labels[threshold as SnowThreshold] || `> ${threshold}"`;
}

export function getIceProbabilityColor(probability: number): string {
    const rounded = Math.floor(probability / 10) * 10;
    const lookup = Math.max(10, Math.min(100, rounded));
    return ICE_PROB_COLORS[lookup] || '#f48fb1';
}

export function getIceThresholdLabel(): string {
    return '≥ 0.25"';
}
