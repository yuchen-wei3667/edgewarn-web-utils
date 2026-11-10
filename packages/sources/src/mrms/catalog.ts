import { MRMS_CATALOG_ROWS } from './catalog-data.ts';
import { describeProduct, GENERIC_SPEC, STD_SENTINELS } from './catalog-overrides.ts';
import { shortLabelFor } from './catalog-short-labels.ts';
import type { MrmsCatalogRow, MrmsProduct } from './catalog-types.ts';

export type { MrmsGroup, MrmsProduct, MrmsFamily, MrmsCatalogRow, PoolMode } from './catalog-types.ts';
export { describeProduct } from './catalog-overrides.ts';
export { shortLabelFor } from './catalog-short-labels.ts';
export { MRMS_GROUP_ORDER } from './catalog-overrides.ts';

export const DEFAULT_MRMS_PRODUCT = 'MergedReflectivityQCComposite_00.50';
const HEAVY_KB = 5 * 1024;

function buildProduct(row: Pick<MrmsCatalogRow, 'id' | 'available' | 'sizeKB'> & Partial<MrmsCatalogRow>): MrmsProduct {
    const spec = describeProduct(row.id);
    const sizeKB = row.sizeKB ?? 0;
    const label = spec?.label ?? row.id;
    return {
        id: row.id,
        label,
        shortLabel: shortLabelFor(row.id, label, spec?.family),
        group: spec?.group ?? GENERIC_SPEC.group,
        units: spec?.units ?? GENERIC_SPEC.units,
        colormap: spec?.colormap ?? GENERIC_SPEC.colormap,
        pool: spec?.pool ?? 'max',
        interpolate: spec?.interpolate ?? true,
        sentinels: spec?.sentinels ?? STD_SENTINELS,
        ...(spec?.categories ? { categories: spec.categories } : {}),
        ...(spec?.displayScale !== undefined ? { displayScale: spec.displayScale } : {}),
        ...(spec?.hideBelow !== undefined ? { hideBelow: spec.hideBelow } : {}),
        ...(spec?.hideValues ? { hideValues: spec.hideValues } : {}),
        ...(spec?.family ? { family: spec.family } : {}),
        ...(spec?.legacyIds ? { legacyIds: spec.legacyIds } : {}),
        ...(sizeKB > HEAVY_KB ? { heavy: true } : {}),
        sizeKB,
        grid: row.ni && row.nj && row.di ? { ni: row.ni, nj: row.nj, di: row.di } : null,
        domain: 'CONUS',
        available: row.available,
    };
}

export const MRMS_PRODUCTS: readonly MrmsProduct[] = MRMS_CATALOG_ROWS.map(buildProduct);
const BY_ID = new Map(MRMS_PRODUCTS.map((p) => [p.id, p]));
const LEGACY_TO_ID = new Map(MRMS_PRODUCTS.flatMap((p) => (p.legacyIds ?? []).map((legacy) => [legacy, p.id] as const)));

/** Look up by S3 ID or by a legacy EWMRS `MRMS_*` ID. */
export const getMrmsProduct = (id: string): MrmsProduct | undefined => BY_ID.get(LEGACY_TO_ID.get(id) ?? id);

/** Map an EWMRS product ID to its S3 product ID; S3 IDs pass through unchanged. */
export function resolveMrmsId(id: string): string | null {
    if (BY_ID.has(id)) return id;
    return LEGACY_TO_ID.get(id) ?? null;
}

/** True for any ID that should be served from S3 rather than EWMRS (S3 names and `MRMS_*` legacy IDs). */
export const isMrmsProductId = (id: string): boolean => resolveMrmsId(id) !== null;

/** The other levels of a 3D family, lowest first. */
export function familyProducts(familyId: string): MrmsProduct[] {
    return MRMS_PRODUCTS.filter((p) => p.family?.id === familyId).sort((a, b) => a.family!.levelKm - b.family!.levelKm);
}

/**
 * Reconcile the checked-in catalog with a live `CONUS/` directory listing: products missing from
 * the bucket (or flagged dead by the generator) are hidden, and directories the catalog has never
 * seen appear under "Other" with a generic colormap. `listed` null means the listing failed, so the
 * checked-in availability is trusted.
 */
export function reconcileCatalog(listed: readonly string[] | null): MrmsProduct[] {
    if (!listed) return MRMS_PRODUCTS.filter((p) => p.available);
    const live = new Set(listed);
    const known = MRMS_PRODUCTS.filter((p) => live.has(p.id) && p.available);
    const unknown = listed.filter((id) => !BY_ID.has(id)).map((id) => buildProduct({ id, available: true, sizeKB: 0 }));
    return [...known, ...unknown];
}
