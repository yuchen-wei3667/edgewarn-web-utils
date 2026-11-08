import type * as GeoJSON from 'geojson';
export interface NWSAlertProperties {
    '@id'?: string;
    '@type'?: string;
    id: string;
    areaDesc: string;
    geocode: {
        SAME: string[];
        UGC: string[];
    };
    affectedZones: string[];
    sent: string;
    effective: string;
    onset: string;
    expires: string;
    ends: string;
    status: string;
    messageType: string;
    category: string;
    severity: 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';
    certainty: string;
    urgency: string;
    event: string;
    sender: string;
    senderName: string;
    headline: string;
    description: string;
    instruction: string;
    response: string;
}

export interface NWSAlertFeature {
    id: string;
    type: 'Feature';
    geometry: GeoJSON.Geometry | null;
    properties: NWSAlertProperties;
    Polygon?: number[][] | number[][][];
}

export interface NWSData {
    type: 'nws';
    timestamp: string;
    data: {
        type: 'FeatureCollection';
        features: NWSAlertFeature[];
    };
}
