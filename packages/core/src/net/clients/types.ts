/** Row and feature shapes of the public-feed clients. */

export type SPCStormReportType = 'tornado' | 'hail' | 'wind';

export interface SPCStormReportProperties {
    reportType: SPCStormReportType;
    reportTypeLabel: string;
    magnitude: string | null;
    location: string;
    county: string;
    state: string;
    lat: number;
    lon: number;
    comments: string | null;
    valid: string;
    displayTime: string;
}

export interface SPCStormReportFeature {
    id: string;
    type: 'Feature';
    properties: SPCStormReportProperties;
    geometry: {
        type: 'Point';
        coordinates: [number, number];
    };
}

export interface SPCStormReportsGeoJSON {
    type: 'FeatureCollection';
    features: SPCStormReportFeature[];
}

export interface LSRFeatureProperties {
    wfo: string;
    type: string;
    magf: number | null;
    county: string;
    typetext: string;
    state: string;
    remark: string | null;
    city: string;
    source: string;
    unit: string | null;
    valid: string;
    lon: number;
    lat: number;
    qualifier: string | null;
    product_id: string;
    st: string;
    magnitude: string;
}

export interface LSRFeature {
    id: string;
    type: 'Feature';
    properties: LSRFeatureProperties;
    geometry: {
        type: 'Point';
        coordinates: [number, number];
    };
}

export interface LSRGeoJSON {
    type: 'FeatureCollection';
    features: LSRFeature[];
}

export interface CoCoRaHSFeatureProperties {
    stationId: string;
    stationName: string;
    network: string;
    valid: string;
    precipitation24h: number | null;
    snow24h: number | null;
    snowDepth: number | null;
    reportHourLocal: number | null;
}

export interface CoCoRaHSFeature {
    id: string;
    type: 'Feature';
    properties: CoCoRaHSFeatureProperties;
    geometry: {
        type: 'Point';
        coordinates: [number, number];
    };
}

export interface CoCoRaHSGeoJSON {
    type: 'FeatureCollection';
    features: CoCoRaHSFeature[];
}

export interface MetarEntry {
    observation_time: string;
    station: string;
    coordinates: [number, number];
    wind: {
        direction: string;
        speed: string;
        gust: string | null;
    };
    temperature: string;
    dewpoint: string;
}

export interface MetarData {
    type: 'metar';
    timestamp: string;
    data: MetarEntry[];
}

export type SPCWatchType = 'Severe Thunderstorm' | 'Tornado' | 'Unknown';
export interface SPCWatchProbabilities {
    twoOrMoreTornadoes: string | null;
    strongTornadoes: string | null;
    tenOrMoreSevereWindEvents: string | null;
    windEvents65KnotsOrMore: string | null;
    tenOrMoreSevereHailEvents: string | null;
    hailEvents2InchesOrMore: string | null;
    sixOrMoreCombinedSevereHailWindEvents: string | null;
}

export interface SPCWatchAttributes {
    maxHailInches: number | null;
    maxWindGustKnots: number | null;
    maxTopsHundredsFeet: number | null;
    meanStormMotionVector: string | null;
    particularlyDangerousSituation: boolean | null;
}

export interface SPCWatchSourceUrls {
    productText: string;
    watchPage: string;
}

export interface SPCWatchDetails {
    watchNumber: number;
    type: SPCWatchType;
    metadataLines: string[];
    probabilities: SPCWatchProbabilities;
    attributes: SPCWatchAttributes;
    sourceUrls: SPCWatchSourceUrls;
}
