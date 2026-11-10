export type WindSpeedUnit = 'kts' | 'mph' | 'km/h';

const KNOTS_TO_MPH = 1.150779448;
const KNOTS_TO_KMH = 1.852;
const METERS_PER_SECOND_TO_KNOTS = 1.943844492;
const METERS_PER_SECOND_TO_MPH = 2.236936292;
const METERS_PER_SECOND_TO_KMH = 3.6;

export function convertKnots(value: number, unit: WindSpeedUnit): number {
    switch (unit) {
        case 'mph':
            return value * KNOTS_TO_MPH;
        case 'km/h':
            return value * KNOTS_TO_KMH;
        default:
            return value;
    }
}

export function convertMetersPerSecond(value: number, unit: WindSpeedUnit): number {
    switch (unit) {
        case 'kts':
            return value * METERS_PER_SECOND_TO_KNOTS;
        case 'km/h':
            return value * METERS_PER_SECOND_TO_KMH;
        default:
            return value * METERS_PER_SECOND_TO_MPH;
    }
}

export function formatWindSpeed(value: number, unit: WindSpeedUnit): string {
    return `${Math.round(value)}${unit}`;
}

const MPH_TO_KNOTS = 0.868976242;
const MPH_TO_KMH = 1.609344;

export function convertMilesPerHour(value: number, unit: WindSpeedUnit): number {
    switch (unit) {
        case 'kts':
            return value * MPH_TO_KNOTS;
        case 'km/h':
            return value * MPH_TO_KMH;
        default:
            return value;
    }
}
