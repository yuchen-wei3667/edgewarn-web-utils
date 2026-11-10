/**
 * Module defaults for the model engine. They were the website's `config/models.ts` constants; everything that is
 * about the page (level of detail, GPU uploads, playback dwell, device budgets) stays on the website.
 */

/** Interior texels per tile side. Every texture is MODEL_TILE_SIZE + 2 * MODEL_TILE_HALO wide. */
export const MODEL_TILE_SIZE = 256;
/** Texels copied from each neighbouring tile so bilinear sampling never needs a second texture. */
export const MODEL_TILE_HALO = 1;

/** Hours searched back from the current hour when looking for the newest published run. */
export const MODEL_RUN_LOOKBACK = 24;
/** A probe retries a 5xx or 429 this many times in all before the host counts as unreachable... */
export const MODEL_PROBE_ATTEMPTS = 3;
/** ...waiting this long (times the attempt number) between tries. */
export const MODEL_PROBE_RETRY_MS = 400;

/** Isobars are drawn every this many hPa, and every `ISOBAR_MAJOR_EVERY`th one is drawn heavier (and so is 1000, 1020...). */
export const ISOBAR_INTERVAL_HPA = 2;
export const ISOBAR_MAJOR_EVERY = 5;
/** [1 2 1] smoothing passes over the level before contouring, so reduced-to-sea-level noise over mountains stays off the map. */
export const ISOBAR_SMOOTH_PASSES = 1;
/** Highs and Lows are searched on every this-many'th texel, which is plenty for features hundreds of km across. */
export const PRESSURE_CENTER_STRIDE = 2;
/** A High or Low is the extreme of a square this many (strided) texels either side of it... */
export const PRESSURE_CENTER_RADIUS_TEXELS = 18;
/** ...and must differ from the average pressure on that square's edge by at least this many hPa. */
export const PRESSURE_CENTER_PROMINENCE_HPA = 2;
/** Centres this close to the edge of the grid are artefacts of the edge, not systems. */
export const PRESSURE_CENTER_EDGE_TEXELS = 6;

/** Maximum resident comparison working set; larger jobs are refused before operands are read. */
export const COMPARE_JOB_MAX_BYTES = 96 * 1024 * 1024;
/** Half range of a percent difference colormap, in percent. */
export const COMPARE_PERCENT_HALF_RANGE = 100;

/**
 * Distance, metres, across which a diagnostic field's horizontal derivative is taken (`derivatives.ts`):
 * centred differences over this span, rounded to a whole number of cells (at least one on each side). float16 storage
 * leaves a single-cell difference on a 3 km grid too noisy for advection and frontogenesis.
 */
export const DERIVATIVE_BASELINE_M = 12_000;
/** Mean earth radius of the great-circle spacing of derivative cells, metres. */
export const DERIVATIVE_EARTH_RADIUS_M = 6_371_229;
/** A cell whose span is shorter than this, metres, is at a pole of a lat/lon grid: its derivative is NaN. */
export const DERIVATIVE_MIN_SPAN_M = 1;
/** Seconds in an hour: temperature advection is stored in °C per hour. */
export const SECONDS_PER_HOUR = 3600;
/** Frontogenesis is stored in K per 100 km per 3 h (the convention of Keyser et al. 1988 and the SPC/WPC maps). */
export const FRONTOGENESIS_DISTANCE_M = 100_000;
export const FRONTOGENESIS_PERIOD_S = 3 * SECONDS_PER_HOUR;
/** Metres per kilometre, for the lapse rate stored in °C per km. */
export const METRES_PER_KM = 1000;
/** Grids whose derivative tables are kept (each holds four float32 arrays of the grid's size). */
export const DERIVATIVE_METRIC_CACHE = 2;

/** Earth's rotation rate, rad/s, for the Coriolis parameter in potential vorticity. */
export const EARTH_ROTATION_RAD_S = 7.292115e-5;
/** Pascals per hectopascal: the level pressures are in hPa, the integrals and vertical derivatives per Pa. */
export const PASCALS_PER_HPA = 100;
/** Specific humidity is read in g/kg (float16 keeps it precise); the transports integrate it in kg/kg. */
export const GRAMS_PER_KG = 1000;
/** Potential vorticity is stored in PVU: 1e-6 K m2 kg-1 s-1. */
export const PVU_PER_SI = 1e6;
/** Absolute vorticity is stored in 1e-5 s-1, the unit its colormap and the model's own ABSV field use. */
export const VORTICITY_STORED_PER_SI = 1e5;
/** Q-vector magnitude is stored in 1e-11 m2 kg-1 s-1 and its convergence in 1e-16 m kg-1 s-1, to sit in float16's precise range. */
export const Q_VECTOR_STORED_PER_SI = 1e11;
export const Q_VECTOR_CONVERGENCE_STORED_PER_SI = 1e16;
/** The quasi-geostrophic omega equation forces ascent with -2 div(Q). */
export const Q_VECTOR_CONVERGENCE_FACTOR = 2;
/** The mean wind of the storm-relative flow is taken over this depth above ground, metres, and needs at least the second. */
export const STORM_MEAN_DEPTH_M = 6000;
export const STORM_MEAN_MIN_DEPTH_M = 4000;
/** Integration step of a parcel trajectory, seconds. */
export const TRAJECTORY_STEP_S = 300;
