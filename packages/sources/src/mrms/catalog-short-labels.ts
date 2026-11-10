import type { MrmsFamily } from './catalog-types.ts';

/** Hand-picked chip text where the rules below would be ambiguous or unclear. */
const EXACT: Record<string, string> = {
    'BREF_1HR_MAX_00.50': 'Base 1-h max',
    'CREF_1HR_MAX_00.50': 'Composite 1-h max',
    'HeightCompositeReflectivity_00.50': 'Composite height',
    'HeightLowLevelCompositeReflectivity_00.50': 'Low-level height',
    'LayerCompositeReflectivity_ANC_00.50': 'Layer (ANC)',
    'LayerCompositeReflectivity_High_00.50': 'Layer (high)',
    'LayerCompositeReflectivity_Low_00.50': 'Layer (low)',
    'LayerCompositeReflectivity_Super_00.50': 'Layer (super)',
    'LowLevelCompositeReflectivity_00.50': 'Low-level composite',
    'MergedBaseReflectivity_00.50': 'Base',
    'MergedBaseReflectivityQC_00.50': 'Base (QC)',
    'MergedReflectivityAtLowestAltitude_00.50': 'Lowest altitude',
    'MergedReflectivityComposite_00.50': 'Composite',
    'MergedReflectivityQCComposite_00.50': 'Composite (QC)',
    'MergedReflectivityQComposite_00.50': 'Composite (Q)',
    'ReflectivityAtLowestAltitude_00.50': 'Lowest alt. (unmerged)',
    'MESH_00.50': 'MESH',
    'POSH_00.50': 'POSH',
    'SHI_00.50': 'SHI',
    'LVL3_HREET_00.50': 'Hi-res (L3)',
    'LVL3_HighResVIL_00.50': 'Hi-res (L3)',
    'VIL_00.50': 'VIL',
    'VII_00.50': 'VII',
    'VIL_Density_00.50': 'VIL density',
    'PrecipRate_00.00': 'Rate',
    'PrecipFlag_00.00': 'Type',
    'SyntheticPrecipRateID_00.00': 'Rate source',
    'SeamlessHSR_00.00': 'SHSR',
    'SeamlessHSRHeight_00.00': 'SHSR height',
    'WarmRainProbability_00.50': 'Warm rain',
    LtgJumpGrid_scale_1: 'Jump',
    'Model_0degC_Height_00.50': '0 °C height',
    'Model_SurfaceTemp_00.50': 'Surface temp',
    'Model_WetBulbTemp_00.50': 'Wet-bulb temp',
    'BrightBandTopHeight_00.00': 'Bright band top',
    'BrightBandBottomHeight_00.00': 'Bright band bottom',
    'RadarQualityIndex_00.00': 'Radar quality',
};

/** Longest-first so "Radar-Only QPE since 12Z" does not match a shorter prefix. */
const PREFIXES: Array<[RegExp, string]> = [
    [/^Radar-Only QPE,? ?/, 'Radar '],
    [/^Multi-Sensor QPE, ?/, 'Multi '],
    [/^FLASH QPE Return Period, ?/, 'ARI '],
    [/^FLASH QPE \/ Flash Flood Guidance, ?/, 'FFG '],
    [/^FLASH (\w+) Max /, '$1 '],
    [/^Rotation Track \(Mid-Level\), ?/, 'Mid '],
    [/^Rotation Track, ?/, ''],
    [/^Height of (\d+) dBZ above (-?\d+) °C/, 'H$1 above $2 °C'],
    [/^Gauge Influence Index, ?/, 'Gauge '],
    [/^Accumulation Quality Index, ?/, 'Accum. '],
];

/**
 * Short name for a chip in the layer picker. 3D families use their height, hand-picked names win,
 * then known prefixes are compressed, and otherwise the part after the first comma or " at " is used.
 * The picker falls back to the full label for a chip whose short text repeats inside its row.
 */
export function shortLabelFor(id: string, label: string, family?: MrmsFamily): string {
    if (family) return `${family.levelKm} km`;
    const exact = EXACT[id];
    if (exact) return exact;
    for (const [pattern, replacement] of PREFIXES) {
        if (pattern.test(label)) return label.replace(pattern, replacement).replace(/\s*\(Pass (\d)\)/, ' P$1').trim();
    }
    const comma = label.indexOf(', ');
    if (comma > 0) return label.slice(comma + 2);
    const at = label.indexOf(' at ');
    if (at > 0) return label.slice(at + 4);
    return label;
}
