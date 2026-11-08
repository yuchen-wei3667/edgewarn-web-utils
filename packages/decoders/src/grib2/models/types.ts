/** Affine transform folded into the unpack constants, e.g. Pa -> hPa so values fit float16 range. */
export interface ValueTransform {
    scale?: number;
    offset?: number;
}

/** How a level merges the source cells under one output texel. */
export type LevelReducer = 'mean' | 'max' | 'mode';

/** Regular latitude/longitude (GRIB template 3.0). */
export interface GridRotation {
    southPoleLat: number;
    southPoleLon: number;
}
