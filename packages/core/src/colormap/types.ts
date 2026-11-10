// Colormap types for weather product visualization
export interface ColormapThreshold {
    value: number;
    rgb: [number, number, number];
    alpha?: number;
}

export interface Colormap {
    name: string;
    description: string;
    type: string;
    units: string;
    interpolate: boolean;
    /** Linearly interpolate opacity, including transparent stops, instead of treating them as cutoffs. */
    interpolateAlpha?: boolean;
    range: [number, number];
    thresholds: ColormapThreshold[];
    legendImageUrl?: string; // Optional URL for a pre-rendered legend image (e.g. from WMS)
    uniformBlocks?: boolean; // If true, render thresholds as equal-width blocks regardless of value spacing
}
