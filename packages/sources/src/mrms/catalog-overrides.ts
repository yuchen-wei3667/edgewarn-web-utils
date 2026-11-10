import type { MrmsFamily, MrmsGroup, PoolMode } from './catalog-types.ts';

/**
 * Hand-maintained product knowledge. The generator only writes the catalog rows (catalog-data.ts) and never
 * touches this file. Sentinels, display floors and units were checked
 * against decoded files on 2026-10-11.
 */
interface ProductSpec {
    label: string;
    group: MrmsGroup;
    units: string;
    colormap: string;
    pool?: PoolMode;
    interpolate?: boolean;
    sentinels?: number[];
    categories?: Readonly<Record<number, string>>;
    /** Multiplier from the file's units to `units`; hideBelow and hideValues are in `units`. */
    displayScale?: number;
    hideBelow?: number;
    hideValues?: number[];
    family?: MrmsFamily;
    legacyIds?: string[];
}

/**
 * No-data values seen across products: -999 no coverage, -99 missing, -3 usual no-data, -9999 FLASH
 * soil/streamflow, -99900 lightning probability and jump grids. Packing is read from each file, so
 * a value that a file cannot represent is simply ignored.
 */
export const STD_SENTINELS = [-999, -99, -9999, -99900, -3];
/** For products where -3 is a real value (shear, differential reflectivity, temperatures). */
const SENTINELS_KEEP_M3 = [-999, -99, -9999, -99900];

export const GENERIC_SPEC: Omit<ProductSpec, 'label'> = {
    group: 'other', units: '', colormap: 'MRMS_Probability',
};

const HIDE_NONPOSITIVE = { hideBelow: 0, hideValues: [0] };

/** MRMS PrecipFlag codes (surface precipitation type). */
const PRECIP_TYPE_NAMES: Readonly<Record<number, string>> = {
    0: 'No precipitation',
    1: 'Warm stratiform rain',
    3: 'Snow',
    4: 'Convective rain',
    6: 'Hail',
    7: 'Tropical rain',
    10: 'Cool stratiform rain',
    91: 'Tropical/stratiform rain mix',
    96: 'Tropical/convective rain mix',
};

/** The H50/H60 files hold kilometres; they are shown in metres, like the other height products. */
const KM_SHOWN_AS_M = { units: 'm', colormap: 'MRMS_Height', displayScale: 1000, hideBelow: 0 };

const refl = (label: string, extra: Partial<ProductSpec> = {}): ProductSpec => ({
    label, group: 'reflectivity', units: 'dBZ', colormap: 'reflectivity', ...HIDE_NONPOSITIVE, ...extra,
});

/** Exact-ID specs. */
const SINGLES: Record<string, ProductSpec> = {
    'BREF_1HR_MAX_00.50': refl('Base Reflectivity, 1-h Max'),
    'CREF_1HR_MAX_00.50': refl('Composite Reflectivity, 1-h Max'),
    'HeightCompositeReflectivity_00.50': { label: 'Height of Composite Reflectivity', group: 'reflectivity', units: 'm', colormap: 'MRMS_Height', hideBelow: 0 },
    'HeightLowLevelCompositeReflectivity_00.50': { label: 'Height of Low-Level Composite Reflectivity', group: 'reflectivity', units: 'm', colormap: 'MRMS_Height', hideBelow: 0 },
    'LayerCompositeReflectivity_ANC_00.50': refl('Layer Composite Reflectivity (ANC)'),
    'LayerCompositeReflectivity_High_00.50': refl('Layer Composite Reflectivity (High)'),
    'LayerCompositeReflectivity_Low_00.50': refl('Layer Composite Reflectivity (Low)'),
    'LayerCompositeReflectivity_Super_00.50': refl('Layer Composite Reflectivity (Super)'),
    'LowLevelCompositeReflectivity_00.50': refl('Low-Level Composite Reflectivity'),
    'MergedBaseReflectivity_00.50': refl('Base Reflectivity'),
    'MergedBaseReflectivityQC_00.50': refl('Base Reflectivity (QC)'),
    'MergedReflectivityAtLowestAltitude_00.50': refl('Reflectivity at Lowest Altitude', { legacyIds: ['MRMS_ReflectivityAtLowestAltitude'] }),
    'MergedReflectivityComposite_00.50': refl('Composite Reflectivity'),
    'MergedReflectivityQCComposite_00.50': refl('Composite Reflectivity (QC)', { legacyIds: ['MRMS_MergedReflectivityQC'] }),
    'MergedReflectivityQComposite_00.50': refl('Composite Reflectivity (Q)'),
    'ReflectivityAtLowestAltitude_00.50': refl('Reflectivity at Lowest Altitude (unmerged)'),

    'Reflectivity_0C_00.50': { label: 'Reflectivity at 0 °C', group: 'isothermal', units: 'dBZ', colormap: 'reflectivity', ...HIDE_NONPOSITIVE, legacyIds: ['MRMS_ReflectivityAt0C'] },
    'Reflectivity_-5C_00.50': { label: 'Reflectivity at -5 °C', group: 'isothermal', units: 'dBZ', colormap: 'reflectivity', ...HIDE_NONPOSITIVE, legacyIds: ['MRMS_ReflectivityAtM5C'] },
    'Reflectivity_-10C_00.50': { label: 'Reflectivity at -10 °C', group: 'isothermal', units: 'dBZ', colormap: 'reflectivity', ...HIDE_NONPOSITIVE },
    'Reflectivity_-15C_00.50': { label: 'Reflectivity at -15 °C', group: 'isothermal', units: 'dBZ', colormap: 'reflectivity', ...HIDE_NONPOSITIVE, legacyIds: ['MRMS_ReflectivityAtM15C'] },
    'Reflectivity_-20C_00.50': { label: 'Reflectivity at -20 °C', group: 'isothermal', units: 'dBZ', colormap: 'reflectivity', ...HIDE_NONPOSITIVE },

    'EchoTop_18_00.50': { label: 'Echo Top, 18 dBZ', group: 'echotops', units: 'km', colormap: 'EchoTops', ...HIDE_NONPOSITIVE, legacyIds: ['MRMS_EchoTop18'] },
    'EchoTop_30_00.50': { label: 'Echo Top, 30 dBZ', group: 'echotops', units: 'km', colormap: 'EchoTops', ...HIDE_NONPOSITIVE, legacyIds: ['MRMS_EchoTop30'] },
    'EchoTop_50_00.50': { label: 'Echo Top, 50 dBZ', group: 'echotops', units: 'km', colormap: 'EchoTops', ...HIDE_NONPOSITIVE },
    'EchoTop_60_00.50': { label: 'Echo Top, 60 dBZ', group: 'echotops', units: 'km', colormap: 'EchoTops', ...HIDE_NONPOSITIVE },
    'LVL3_HREET_00.50': { label: 'High-Resolution Echo Top (Level 3)', group: 'echotops', units: 'km', colormap: 'EchoTops', ...HIDE_NONPOSITIVE },

    'MESH_00.50': { label: 'MESH (Maximum Expected Size of Hail)', group: 'hail', units: 'mm', colormap: 'MESH', ...HIDE_NONPOSITIVE, legacyIds: ['MRMS_MESH'] },
    'POSH_00.50': { label: 'Probability of Severe Hail', group: 'hail', units: '%', colormap: 'MRMS_Probability', ...HIDE_NONPOSITIVE },
    'SHI_00.50': { label: 'Severe Hail Index', group: 'hail', units: 'index', colormap: 'MRMS_SHI', ...HIDE_NONPOSITIVE },
    'H50_Above_-20C_00.50': { label: 'Height of 50 dBZ above -20 °C', group: 'hail', ...KM_SHOWN_AS_M },
    'H50_Above_0C_00.50': { label: 'Height of 50 dBZ above 0 °C', group: 'hail', ...KM_SHOWN_AS_M },
    'H60_Above_-20C_00.50': { label: 'Height of 60 dBZ above -20 °C', group: 'hail', ...KM_SHOWN_AS_M },
    'H60_Above_0C_00.50': { label: 'Height of 60 dBZ above 0 °C', group: 'hail', ...KM_SHOWN_AS_M },

    'MergedAzShear_0-2kmAGL_00.50': { label: 'Azimuthal Shear, 0-2 km AGL', group: 'rotation', units: '10⁻³ s⁻¹', colormap: 'AzShear', pool: 'maxAbs', sentinels: SENTINELS_KEEP_M3, ...HIDE_NONPOSITIVE, legacyIds: ['MRMS_MergedAzShear_0-2kmAGL'] },
    'MergedAzShear_3-6kmAGL_00.50': { label: 'Azimuthal Shear, 3-6 km AGL', group: 'rotation', units: '10⁻³ s⁻¹', colormap: 'AzShear', pool: 'maxAbs', sentinels: SENTINELS_KEEP_M3, ...HIDE_NONPOSITIVE, legacyIds: ['MRMS_MergedAzShear_3-6kmAGL'] },

    'VIL_00.50': { label: 'Vertically Integrated Liquid', group: 'vil', units: 'kg/m²', colormap: 'VIL/VII', ...HIDE_NONPOSITIVE, legacyIds: ['MRMS_VIL'] },
    'VII_00.50': { label: 'Vertically Integrated Ice', group: 'vil', units: 'kg/m²', colormap: 'VIL/VII', ...HIDE_NONPOSITIVE, legacyIds: ['MRMS_VII'] },
    'VIL_Density_00.50': { label: 'VIL Density', group: 'vil', units: 'g/m³', colormap: 'VILDensity', ...HIDE_NONPOSITIVE, legacyIds: ['MRMS_VILDensity'] },
    'VIL_Max_120min_00.50': { label: 'VIL, 2-h Max', group: 'vil', units: 'kg/m²', colormap: 'VIL/VII', ...HIDE_NONPOSITIVE },
    'VIL_Max_1440min_00.50': { label: 'VIL, 24-h Max', group: 'vil', units: 'kg/m²', colormap: 'VIL/VII', ...HIDE_NONPOSITIVE },
    'LVL3_HighResVIL_00.50': { label: 'High-Resolution VIL (Level 3)', group: 'vil', units: 'kg/m²', colormap: 'VIL/VII', ...HIDE_NONPOSITIVE },

    'PrecipRate_00.00': { label: 'Precipitation Rate', group: 'precip', units: 'mm/hr', colormap: 'PrecipitationRate', ...HIDE_NONPOSITIVE, legacyIds: ['MRMS_PrecipRate'] },
    'PrecipFlag_00.00': { label: 'Precipitation Type', group: 'precip', units: 'category', colormap: 'MRMS_PrecipFlag', pool: 'nearest', interpolate: false, hideValues: [0], categories: PRECIP_TYPE_NAMES },
    'SyntheticPrecipRateID_00.00': { label: 'Synthetic Precipitation Rate Source', group: 'precip', units: 'category', colormap: 'MRMS_PrecipRateID', pool: 'nearest', interpolate: false, hideBelow: 1 },
    'SeamlessHSR_00.00': { label: 'Seamless Hybrid Scan Reflectivity', group: 'precip', units: 'dBZ', colormap: 'reflectivity', ...HIDE_NONPOSITIVE },
    'SeamlessHSRHeight_00.00': { label: 'Seamless HSR Height', group: 'precip', units: 'km', colormap: 'MRMS_HeightKm', hideBelow: 0 },
    'WarmRainProbability_00.50': { label: 'Warm Rain Probability', group: 'precip', units: '%', colormap: 'MRMS_Probability', hideBelow: 1 },

    'NLDN_CG_001min_AvgDensity_00.00': { label: 'Cloud-to-Ground Lightning, 1 min', group: 'lightning', units: 'flashes/km²/min', colormap: 'LightningDensity', ...HIDE_NONPOSITIVE, legacyIds: ['MRMS_NLDN_CG_001min_AvgDensity'] },
    'NLDN_CG_005min_AvgDensity_00.00': { label: 'Cloud-to-Ground Lightning, 5 min', group: 'lightning', units: 'flashes/km²/min', colormap: 'LightningDensity', ...HIDE_NONPOSITIVE },
    'NLDN_CG_015min_AvgDensity_00.00': { label: 'Cloud-to-Ground Lightning, 15 min', group: 'lightning', units: 'flashes/km²/min', colormap: 'LightningDensity', ...HIDE_NONPOSITIVE },
    'NLDN_CG_030min_AvgDensity_00.00': { label: 'Cloud-to-Ground Lightning, 30 min', group: 'lightning', units: 'flashes/km²/min', colormap: 'LightningDensity', ...HIDE_NONPOSITIVE },
    LightningProbabilityNext30minGrid_scale_1: { label: 'Lightning Probability, Next 30 min', group: 'lightning', units: '%', colormap: 'MRMS_Probability', hideBelow: 1 },
    LightningProbabilityNext60minGrid_scale_1: { label: 'Lightning Probability, Next 60 min', group: 'lightning', units: '%', colormap: 'MRMS_Probability', hideBelow: 1 },
    LtgJumpGrid_Max_005min_scale_1: { label: 'Lightning Jump, 5-min Max', group: 'lightning', units: 'index', colormap: 'MRMS_LightningJump', hideBelow: 1 },
    LtgJumpGrid_scale_1: { label: 'Lightning Jump', group: 'lightning', units: 'index', colormap: 'MRMS_LightningJump', hideBelow: 1 },

    'Model_0degC_Height_00.50': { label: '0 °C Level Height', group: 'environment', units: 'm', colormap: 'MRMS_Height', pool: 'nearest', hideBelow: 1 },
    'Model_SurfaceTemp_00.50': { label: 'Surface Temperature', group: 'environment', units: '°C', colormap: 'MRMS_Temperature', pool: 'nearest', sentinels: SENTINELS_KEEP_M3 },
    'Model_WetBulbTemp_00.50': { label: 'Wet-Bulb Temperature', group: 'environment', units: '°C', colormap: 'MRMS_Temperature', pool: 'nearest', sentinels: SENTINELS_KEEP_M3 },
    'BrightBandTopHeight_00.00': { label: 'Bright Band Top Height', group: 'environment', units: 'm', colormap: 'MRMS_Height', hideBelow: 0 },
    'BrightBandBottomHeight_00.00': { label: 'Bright Band Bottom Height', group: 'environment', units: 'm', colormap: 'MRMS_Height', hideBelow: 0 },

    'RadarQualityIndex_00.00': { label: 'Radar Quality Index', group: 'quality', units: 'index', colormap: 'MRMS_QualityIndex', pool: 'nearest', hideBelow: 0 },
};

const timeWindow = (token: string): string => {
    const m = /^(\d+)(M|H|min)$/.exec(token);
    if (!m) return token;
    const n = Number(m[1]);
    if (m[2] === 'H') return `${n}-h`;
    if (m[2] === 'M') return `${n}-min`;
    return n % 60 === 0 && n >= 60 ? `${n / 60}-h` : `${n}-min`;
};

const stripLevel = (level: string) => String(Number(level));

/** Pattern rules for families and numbered series. */
const RULES: Array<(id: string) => ProductSpec | null> = [
    (id) => {
        const m = /^MergedReflectivityQC_(\d\d\.\d\d)$/.exec(id);
        if (!m) return null;
        return { label: `Reflectivity (QC) at ${stripLevel(m[1])} km`, group: 'reflectivity3d', units: 'dBZ', colormap: 'reflectivity', ...HIDE_NONPOSITIVE, family: { id: 'MergedReflectivityQC', levelKm: Number(m[1]) } };
    },
    (id) => {
        const m = /^MergedZdr_(\d\d\.\d\d)$/.exec(id);
        if (!m) return null;
        return { label: `Differential Reflectivity at ${stripLevel(m[1])} km`, group: 'dualpol3d', units: 'dB', colormap: 'DifferentialReflectivity', sentinels: SENTINELS_KEEP_M3, family: { id: 'MergedZdr', levelKm: Number(m[1]) } };
    },
    (id) => {
        const m = /^MergedRhoHV_(\d\d\.\d\d)$/.exec(id);
        if (!m) return null;
        return { label: `Correlation Coefficient at ${stripLevel(m[1])} km`, group: 'dualpol3d', units: 'ratio', colormap: 'CorrelationCoefficient', pool: 'nearest', family: { id: 'MergedRhoHV', levelKm: Number(m[1]) } };
    },
    (id) => {
        const m = /^MESH_Max_(\d+)min_00\.50$/.exec(id);
        return m ? { label: `MESH, ${timeWindow(`${m[1]}min`)} Max`, group: 'hail', units: 'mm', colormap: 'MESH', ...HIDE_NONPOSITIVE } : null;
    },
    (id) => {
        const m = /^RotationTrack(ML)?(\d+)min_00\.50$/.exec(id);
        return m ? { label: `Rotation Track${m[1] ? ' (Mid-Level)' : ''}, ${timeWindow(`${m[2]}min`)}`, group: 'rotation', units: '10⁻³ s⁻¹', colormap: 'AzShear', sentinels: SENTINELS_KEEP_M3, hideBelow: 1, hideValues: [0] } : null;
    },
    (id) => {
        const m = /^RadarOnly_QPE_(15M|\d+H|Since12Z)_00\.00$/.exec(id);
        if (!m) return null;
        const long = m[1] !== 'Since12Z' && m[1] !== '15M' && Number(m[1].slice(0, -1)) >= 24;
        const label = m[1] === 'Since12Z' ? 'Radar-Only QPE since 12Z' : `Radar-Only QPE, ${timeWindow(m[1])}`;
        return { label, group: 'qpe', units: 'mm', colormap: long ? 'MRMS_QPELong' : 'QPE', ...HIDE_NONPOSITIVE, ...(m[1] === '01H' ? { legacyIds: ['MRMS_QPE'] } : {}) };
    },
    (id) => {
        const m = /^MultiSensor_QPE_(\d+H)_Pass([12])_00\.00$/.exec(id);
        if (!m) return null;
        const long = Number(m[1].slice(0, -1)) >= 24;
        return { label: `Multi-Sensor QPE, ${timeWindow(m[1])} (Pass ${m[2]})`, group: 'qpe', units: 'mm', colormap: long ? 'MRMS_QPELong' : 'QPE', ...HIDE_NONPOSITIVE };
    },
    (id) => {
        const m = /^FLASH_(CREST|SAC|HP)_MAX(SOILSAT|STREAMFLOW|UNITSTREAMFLOW)_00\.00$/.exec(id);
        if (!m) return null;
        const model = m[1] === 'HP' ? 'HP' : m[1];
        const what = {
            SOILSAT: { name: 'Soil Saturation', units: '%', colormap: 'MRMS_SoilSaturation' },
            STREAMFLOW: { name: 'Streamflow', units: 'm³/s', colormap: 'MRMS_Streamflow' },
            UNITSTREAMFLOW: { name: 'Unit Streamflow', units: 'm³/s/km²', colormap: 'MRMS_UnitStreamflow' },
        }[m[2] as 'SOILSAT' | 'STREAMFLOW' | 'UNITSTREAMFLOW'];
        return { label: `FLASH ${model} Max ${what.name}`, group: 'flash', units: what.units, colormap: what.colormap, hideValues: [0] };
    },
    (id) => {
        const m = /^FLASH_QPE_ARI(\d+[MH]|MAX)_00\.00$/.exec(id);
        return m ? { label: `FLASH QPE Return Period, ${m[1] === 'MAX' ? 'Max' : timeWindow(m[1])}`, group: 'flash', units: 'years', colormap: 'MRMS_ARI', hideBelow: 2 } : null;
    },
    (id) => {
        const m = /^FLASH_QPE_FFG(\d+H|MAX)_00\.00$/.exec(id);
        return m ? { label: `FLASH QPE / Flash Flood Guidance, ${m[1] === 'MAX' ? 'Max' : timeWindow(m[1])}`, group: 'flash', units: '%', colormap: 'MRMS_FFGRatio', hideBelow: 25 } : null;
    },
    (id) => {
        const m = /^GaugeInflIndex_(\d+H)_Pass([12])_00\.00$/.exec(id);
        return m ? { label: `Gauge Influence Index, ${timeWindow(m[1])} (Pass ${m[2]})`, group: 'quality', units: 'index', colormap: 'MRMS_GaugeInfluence', pool: 'nearest', hideValues: [-1] } : null;
    },
    (id) => {
        const m = /^RadarAccumulationQualityIndex_(\d+H)_00\.00$/.exec(id);
        return m ? { label: `Accumulation Quality Index, ${timeWindow(m[1])}`, group: 'quality', units: 'index', colormap: 'MRMS_QualityIndex', pool: 'nearest', hideBelow: 0 } : null;
    },
];

export function describeProduct(id: string): ProductSpec | null {
    const single = SINGLES[id];
    if (single) return single;
    for (const rule of RULES) {
        const spec = rule(id);
        if (spec) return spec;
    }
    return null;
}

/** Group display order and labels for the selector. */
export const MRMS_GROUP_ORDER: Array<{ id: MrmsGroup; label: string }> = [
    { id: 'reflectivity', label: 'Reflectivity' },
    { id: 'isothermal', label: 'Isothermal reflectivity' },
    { id: 'reflectivity3d', label: '3D reflectivity' },
    { id: 'dualpol3d', label: 'Dual-pol 3D' },
    { id: 'echotops', label: 'Echo tops' },
    { id: 'hail', label: 'Hail' },
    { id: 'rotation', label: 'Rotation' },
    { id: 'vil', label: 'VIL / VII' },
    { id: 'precip', label: 'Precipitation' },
    { id: 'qpe', label: 'QPE' },
    { id: 'flash', label: 'Flash flood (FLASH)' },
    { id: 'lightning', label: 'Lightning' },
    { id: 'environment', label: 'Environment' },
    { id: 'quality', label: 'Data quality' },
    { id: 'other', label: 'Other' },
];
