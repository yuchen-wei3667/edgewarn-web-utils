/** How a tile pyramid pools source cells into a coarser level. */
export type PoolMode = 'max' | 'nearest' | 'maxAbs';

export type MrmsGroup =
    | 'reflectivity' | 'isothermal' | 'reflectivity3d' | 'dualpol3d' | 'echotops' | 'hail' | 'rotation'
    | 'vil' | 'precip' | 'qpe' | 'flash' | 'lightning' | 'environment' | 'quality' | 'other';

export interface MrmsFamily {
    /** Shared prefix of the S3 directory, e.g. 'MergedReflectivityQC'. */
    id: string;
    levelKm: number;
}

export interface MrmsProduct {
    /** S3 directory name under CONUS/, e.g. 'MergedReflectivityQCComposite_00.50'. */
    id: string;
    label: string;
    /** Chip text in the layer picker; the full label is its tooltip. */
    shortLabel: string;
    group: MrmsGroup;
    family?: MrmsFamily;
    units: string;
    /** `type` of an entry in the colormap bundle. */
    colormap: string;
    pool: PoolMode;
    /** False for categorical products: nearest sampling instead of bilinear. */
    interpolate: boolean;
    /** Physical values that mean "no data" (default list lives in the overrides module). */
    sentinels: number[];
    /** Names for the codes of a categorical product, shown in the value tooltip instead of the number. */
    categories?: Readonly<Record<number, string>>;
    /** Multiplier from the file's units to `units` (e.g. 1000 for a file in km shown in m). Absent means 1. */
    displayScale?: number;
    /** Values below this are hidden (display only, the tooltip still reports them). Given in `units`. */
    hideBelow?: number;
    /** Exact values to hide (display only). */
    hideValues?: number[];
    /** Compressed file over 5 MB: coarser default LOD on phones, no prefetch. */
    heavy?: boolean;
    /** Size of a recent compressed file, from the catalog generator. */
    sizeKB: number;
    /** EWMRS product IDs that map here. */
    legacyIds?: string[];
    domain: 'CONUS';
    /** Nominal grid size and spacing from the generator, used to pick tiles before a file is read. */
    grid: { ni: number; nj: number; di: number } | null;
    /** False when the generator found no files (the dead ANC pair); such products are hidden. */
    available: boolean;
}

/** One row of the checked-in generated catalog. */
export interface MrmsCatalogRow {
    id: string;
    available: boolean;
    ni: number | null;
    nj: number | null;
    di: number | null;
    sizeKB: number | null;
    nbits: number | null;
    D: number | null;
}
