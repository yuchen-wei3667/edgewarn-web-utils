/**
 * Named constants for the sounding science core (`utils/sounding/`). Logic numbers live in the
 * science modules; everything physical or calibrated belongs here (phase 5 plan, section 5.4).
 * Conventions follow SPC/SHARPpy (ADR-P5-4): the constant names below cite where each value comes from.
 */

/** Physical constants (SHARPpy `sharppy/sharptab/constants.py`); retained as the specified public science constants.
 * @public */
export const SOUNDING_RD = 287.04; // J kg⁻¹ K⁻¹, dry-air gas constant
/** @public */
export const SOUNDING_CP = 1005.7; // J kg⁻¹ K⁻¹, dry-air specific heat
/** @public */
export const SOUNDING_RV = 461.5; // J kg⁻¹ K⁻¹, water-vapour gas constant
export const SOUNDING_EPSILON = 0.62197; // Rd / Rv, molar mixing scale (SHARPpy `eps`)
export const SOUNDING_GRAVITY = 9.80665; // m s⁻²
/** @public */
export const SOUNDING_LV = 2.501e6; // J kg⁻¹, latent heat of vaporisation, held constant as SHARPpy does
export const SOUNDING_KELVIN_OFFSET = 273.15; // °C -> K (SHARPpy `ZEROCNK`)
/** Dry-adiabatic pressure exponent. SHARPpy uses 0.28571426 (2/7) in `drylift`, `theta` and `satlift`;
 * it is calibrated to the Wobus moist adiabat, so the sounding core keeps it instead of Rd/Cp. */
export const SOUNDING_DRY_EXPONENT = 0.28571426;
/** Convergence criterion if SHARPpy `satlift`, kept for parity with SPC-calibrated CAPE values. */
export const SOUNDING_SATLIFT_CONV_C = 0.1;

/** Parcel definition depths. */
export const SOUNDING_ML_DEPTH_HPA = 100; // mean-layer parcel mixed over the lowest 100 hPa (SPC)
export const SOUNDING_MU_DEPTH_HPA = 300; // most-unstable parcel searched in the lowest 300 hPa (SPC; SHARPpy's library default is 400)
export const SOUNDING_EFFECTIVE_SEARCH_DEPTH_HPA = 300; // effective-inflow parcels are tested in the lowest 300 hPa (Thompson et al. 2007)

/** Effective-inflow-layer criteria, a parcel qualifies when CAPE >= this and CIN > this. */
export const SOUNDING_EFFECTIVE_CAPE_JKG = 100;
export const SOUNDING_EFFECTIVE_CIN_MAX_JKG = -250;

/** CAPE/CIN integration. */
export const SOUNDING_STRIP_HPA = 5; // integration strips refined to at most this many hPa (plan 5.4)
export const SOUNDING_SEARCH_STRIP_HPA = 10; // coarser mesh while searching layers (effective inflow, DCAPE source)
export const SOUNDING_LAYER_STEP_HPA = 1; // sampling step of pressure-layer means (SHARPpy interpolated `dp = -1`)
export const SOUNDING_CIN_LIMIT_HPA = 500; // CIN counted only below this level (SHARPpy `parcelx`)

/* Layers */
/** Bulk-shear layers (0-1, 0-3, 0-6 km AGL) and SRH layers (0-1, 0-3 km AGL). */
export const SOUNDING_SHEAR_LAYERS_M = [1000, 3000, 6000] as const;
export const SOUNDING_SRH_LAYERS_M = [1000, 3000] as const;
export const SOUNDING_SRH_INTERVAL_M = 250; // SRH hodograph sampling interval (plan 5.4)
export const SOUNDING_BUNKERS_DEVIATION_MS = 7.5; // Bunkers et al. (2000) deviation D
/** Bunkers et al. (2000) layer knots in AGL metres for the shear segment means. */
export const SOUNDING_BUNKERS_LOW_M = 500;
export const SOUNDING_BUNKERS_UPPER_BASE_M = 5500;
export const SOUNDING_BUNKERS_UPPER_TOP_M = 6000;
/** CAPE, lapse rate, PW layer bounds. */
export const SOUNDING_CAPE_DEPTH_M = 3000; // `cape03` collects the positive area up to this height AGL
export const SOUNDING_PW_TOP_HPA = 100; // precipitable water is integrated surface to this level (plan 5.4)
/** mm per (g kg⁻¹ · hPa): (1/g) ∫ r/(1+r) dp with dp in hPa, r in kg/kg scaled to g/kg. */
export const SOUNDING_PW_MM_PER_UNIT = 1 / (10 * SOUNDING_GRAVITY);
export const SOUNDING_DCAPE_SEARCH_DEPTH_HPA = 400; // downdraft parcel source searched in the lowest 400 hPa
export const SOUNDING_DCAPE_LAYER_HPA = 100; // θe is averaged over this layer to find the downdraft source

/** Thompson et al. (2003) fixed-layer significant tornado parameter, with the SPC revision caps. */
export const SOUNDING_STP_FIXED = {
    capeNormJkg: 1500,
    srhNorm: 150,
    shearNormMs: 20,
    shearFloorMs: 12.5,
    shearCapMs: 30,
    shearCapFactor: 1.5,
    lclLowM: 1000, // LCL term is 1 below, 0 above `lclHighM`, linear between
    lclHighM: 2000,
} as const;

/** Thompson et al. (2012) effective-layer significant tornado parameter; the LCL and shear terms
 * share the `stp_fixed` caps, and the CIN term saturates at these bounds. */
export const SOUNDING_STP_EFFECTIVE = {
    cinFloorJkg: -200, // term is 0 at or below
    cinSatJkg: -50, // term is 1 at or above
    cinNormJkg: 150,
} as const;

/** Thompson et al. (2004) supercell composite parameter. */
export const SOUNDING_SCP = {
    capeNormJkg: 1000,
    srhNorm: 50,
    shearNormMs: 20,
    shearFloorMs: 10, // term term is 0 below, capped at the norm above
} as const;

/** SPC significant hail parameter (SHIP), with the SPC adjustments. */
export const SOUNDING_SHIP = {
    denom: 42000000,
    mucapeMinJkg: 1300,
    lr75MinCKm: 5.8,
    frzMinM: 2400,
    mrMinGkg: 11,
    mrMaxGkg: 13.6,
    t500MinC: -5.5,
    shearMinMs: 7,
    shearMaxMs: 27,
} as const;

/** Hart & Korotky (1991) energy-helicity index normalisation (0-1 and 0-3 km). */
export const SOUNDING_EHI_NORM = 160000;

/** Bulk-Richardson number segment depths (SHARPpy `bulk_rich`). */
export const SOUNDING_BRN_LOW_M = 500;
export const SOUNDING_BRN_TOP_M = 6000;

/** Memoisation of `analyzeSounding` results per column hash. */
export const SOUNDING_ANALYSIS_CACHE_SIZE = 32;

/* Column construction from raw model levels (`buildColumn`). */
/** A pressure level this close to the surface pressure (or closer) duplicates the surface row and is dropped. */
export const SOUNDING_SURFACE_GAP_HPA = 0.5;
/** Mean lapse rate of the hypsometric surface-pressure estimate below the lowest level, K m⁻¹ (US Standard Atmosphere). */
export const SOUNDING_STANDARD_LAPSE_K_PER_M = 0.0065;
