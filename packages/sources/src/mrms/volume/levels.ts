import { familyProducts, getMrmsProduct } from '../catalog.ts';
import type { MrmsProduct } from '../catalog.ts';
import { MRMS_VOLUME_LIMITS } from './limits.ts';

/** The three fields the volume tools read, and nothing else. */
export type VolumeField = 'reflectivity' | 'zdr' | 'rhohv';

interface VolumeFieldInfo {
    id: VolumeField;
    /** Catalog family prefix of the 33 level directories. */
    familyId: string;
    label: string;
    shortLabel: string;
    units: string;
    /** `type` of the entry in the colormap bundle. */
    colormapType: string;
    /** Dual-pol fields are hidden where reflectivity is weak. */
    dualPol: boolean;
    /** Decimals shown in readouts. */
    decimals: number;
}

export const VOLUME_FIELDS: readonly VolumeFieldInfo[] = [
    { id: 'reflectivity', familyId: 'MergedReflectivityQC', label: 'Reflectivity (QC)', shortLabel: 'Reflectivity', units: 'dBZ', colormapType: 'reflectivity', dualPol: false, decimals: 0 },
    { id: 'zdr', familyId: 'MergedZdr', label: 'Differential reflectivity', shortLabel: 'ZDR', units: 'dB', colormapType: 'DifferentialReflectivity', dualPol: true, decimals: 1 },
    { id: 'rhohv', familyId: 'MergedRhoHV', label: 'Correlation coefficient', shortLabel: 'ρHV', units: '', colormapType: 'CorrelationCoefficient', dualPol: true, decimals: 3 },
];

export const fieldInfo = (field: VolumeField): VolumeFieldInfo => VOLUME_FIELDS.find((f) => f.id === field)!;

export interface VolumeLevel {
    levelKm: number;
    productId: string;
    product: MrmsProduct;
}

// Derived from the static catalog, so a plain Map never goes stale.
const cache = new Map<VolumeField, VolumeLevel[]>();

/** The field's levels, lowest first, taken from the catalog. */
export function volumeLevels(field: VolumeField): VolumeLevel[] {
    const hit = cache.get(field);
    if (hit) return hit;
    const { familyId } = fieldInfo(field);
    const levels = familyProducts(familyId)
        .filter((p) => p.available && p.family)
        .map((product) => ({ levelKm: product.family!.levelKm, productId: product.id, product }));
    cache.set(field, levels);
    return levels;
}

/** The directory that anchors a field's scan time (lowest level). */
export const anchorProductId = (field: VolumeField): string => volumeLevels(field)[0].productId;

/** The catalog entry of the field's lowest level (colormap, hide rules). */
export const fieldProduct = (field: VolumeField): MrmsProduct => volumeLevels(field)[0].product ?? getMrmsProduct(anchorProductId(field))!;

/**
 * Indices of `heights` in fetch order: the seed heights first (coarse view of the whole column),
 * then repeatedly the level farthest from every level already chosen.
 */
export function loadOrder(heights: readonly number[], seeds: readonly number[] = MRMS_VOLUME_LIMITS.seedLevelsKm): number[] {
    const order: number[] = [];
    const chosen = new Set<number>();
    for (const km of seeds) {
        let best = -1;
        for (let i = 0; i < heights.length; i++) if (!chosen.has(i) && (best < 0 || Math.abs(heights[i] - km) < Math.abs(heights[best] - km))) best = i;
        if (best >= 0 && Math.abs(heights[best] - km) < 0.3) { chosen.add(best); order.push(best); }
    }
    while (order.length < heights.length) {
        let best = -1, bestGap = -1;
        for (let i = 0; i < heights.length; i++) {
            if (chosen.has(i)) continue;
            let gap = Infinity;
            for (const c of chosen) gap = Math.min(gap, Math.abs(heights[i] - heights[c]));
            if (gap > bestGap) { bestGap = gap; best = i; }
        }
        chosen.add(best);
        order.push(best);
    }
    return order;
}
