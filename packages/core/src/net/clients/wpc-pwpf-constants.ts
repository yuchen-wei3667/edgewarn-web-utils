export type SnowThreshold = '04' | '08' | '12';
export type ForecastDay = 1 | 2 | 3;

export const WPC_PWPF_BASE_URL =
    'https://mapservices.weather.noaa.gov/vector/rest/services/precip/wpc_prob_winter_precip/MapServer';

const SNOW_LAYER_IDS: Record<ForecastDay, Record<SnowThreshold, number>> = {
    1: { '04': 1, '08': 2, '12': 3 },
    2: { '04': 6, '08': 7, '12': 8 },
    3: { '04': 11, '08': 12, '12': 13 },
};

export const ICE_LAYER_IDS: Record<ForecastDay, number> = {
    1: 4,
    2: 9,
    3: 14,
};

export function getSnowLayerId(day: ForecastDay, threshold: SnowThreshold): number {
    return SNOW_LAYER_IDS[day][threshold];
}

export function buildLayerQueryUrl(layerId: number, baseUrl: string = WPC_PWPF_BASE_URL): string {
    return `${baseUrl}/${layerId}/query?where=1%3D1&outFields=*&f=geojson`;
}
