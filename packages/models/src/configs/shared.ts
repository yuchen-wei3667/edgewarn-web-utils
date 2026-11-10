/** Pieces several model files share. Not a model, so it sits outside `datasets/`. */

export const HRRR_BUCKET = 'https://noaa-hrrr-bdp-pds.s3.amazonaws.com';
export const RRFS_OPS_BUCKET = 'https://noaa-rrfs-ops-pds.s3.amazonaws.com';
export const NBM_BUCKET = 'https://noaa-nbm-grib2-pds.s3.amazonaws.com';
export const GFS_BUCKET = 'https://noaa-gfs-bdp-pds.s3.amazonaws.com';
export const AIGFS_BUCKET = 'https://noaa-nws-graphcastgfs-pds.s3.amazonaws.com';
export const GEFS_BUCKET = 'https://noaa-gefs-pds.s3.amazonaws.com';
export const HAFS_BUCKET = 'https://noaa-nws-hafs-pds.s3.amazonaws.com';
export const RAP_BUCKET = 'https://noaa-rap-pds.s3.amazonaws.com';
export const CFS_BUCKET = 'https://noaa-cfs-pds.s3.amazonaws.com';
/**
 * ECMWF's open-data mirror on Google Cloud Storage, laid out like the AWS and ECMWF ones. AWS's (`ecmwf-forecasts`)
 * answers 503 "Slow Down" for hours at a time, and a 503 carries no CORS headers, so a browser cannot tell it from
 * an outage; this one answers every request, 404s included, with CORS.
 */
export const ECMWF_BUCKET = 'https://ecmwf-open-data.storage.googleapis.com';
/** Open-Meteo's copy of the model runs, read for point series only (`openMeteo.ts`). */
export const OPEN_METEO_BUCKET = 'https://openmeteo.s3.amazonaws.com';
/** The Met Office's own model output (AWS Open Data, eu-west-2): NetCDF-4, one file per variable per valid time. */
export const MET_OFFICE_BUCKET = 'https://met-office-atmospheric-model-data.s3.eu-west-2.amazonaws.com';

/**
 * Hosts the models may read from: a dataset's `bucket` must be one of them (`registry/validate.ts`). Adding a
 * host is a deliberate edit here, after it has passed `scripts/verify-url-cors.mjs --range`.
 */
export const APPROVED_DATA_ORIGINS: readonly string[] = [
    HRRR_BUCKET,
    RRFS_OPS_BUCKET,
    NBM_BUCKET,
    GFS_BUCKET,
    GEFS_BUCKET,
    AIGFS_BUCKET,
    HAFS_BUCKET,
    RAP_BUCKET,
    CFS_BUCKET,
    ECMWF_BUCKET,
    OPEN_METEO_BUCKET,
    MET_OFFICE_BUCKET,
];

export const ALL_HOURS = Array.from({ length: 24 }, (_, i) => i);

/**
 * RRFS words levels differently from HRRR. The `entire atmosphere` vs
 * `entire atmosphere (considered as a single layer)` split, and the reversed storm-motion layer
 * (`0-6000` vs `6000-0 m above ground`), are the two that bite; both are rewrites rather than extra
 * fields, so one field definition serves every model.
 */
export const RRFS_LEVELS: ReadonlyArray<readonly [string, string]> = [
    ['entire atmosphere', 'entire atmosphere (considered as a single layer)'],
    ['0-6000 m above ground', '6000-0 m above ground'],
];
