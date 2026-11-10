/** Defaults for the GOES-East ABI feed. Every consumer function takes overrides as options. */

/** Public GOES-19 (GOES-East) bucket on AWS Open Data. */
export const GOES_BUCKET_URL = 'https://noaa-goes19.s3.amazonaws.com';
/** Satellite tag in file names. GOES-19 is GOES-East; a new satellite changes this and the bucket. */
export const GOES_SATELLITE = 'G19';
/** Scan mode in file names. If a listing comes back empty, the listing reads the live mode from the keys. */
export const GOES_SCAN_MODE = '6';

/** Scans retained per sector in each cursor-centered timeline window. */
export const GOES_TIMELINE_FRAMES = { C: 4, F: 4, M1: 4, M2: 4 } as const;

/** Interior texels per tile side. Every tile texture is GOES_TILE_SIZE + 2 * GOES_TILE_HALO wide. */
export const GOES_TILE_SIZE = 512;
/** Texels copied from each neighbouring tile so bilinear sampling never needs a second texture. */
export const GOES_TILE_HALO = 1;
/**
 * Warp-mesh cell size in texels at levels 0-2. Coarser levels halve it every two levels (see
 * `meshCellForLevel`): a cell's error grows with its ground size, and at level 6 an 8-texel cell spans
 * 256 km and drifts by 0.9 texel at 72 degrees zenith. Measured worst case with the halving: 0.09 texel
 * under 75 degrees and 0.18 under 80, at every level.
 */
export const GOES_MESH_CELL = 8;
/** Mesh cells viewed beyond this satellite zenith angle are dropped. */
export const GOES_MAX_ZENITH_DEG = 80;
