/** ABI product, band, sector and level-of-detail tables. Pure data and arithmetic; no I/O. */

export const GOES_PRODUCTS = [
    'GOES_ABI_C01_Reflectance',
    'GOES_ABI_C02_Reflectance',
    'GOES_ABI_C03_Reflectance',
    'GOES_ABI_C04_Reflectance',
    'GOES_ABI_C05_Reflectance',
    'GOES_ABI_C06_Reflectance',
    'GOES_ABI_C07_BrightnessTemp',
    'GOES_ABI_C08_BrightnessTemp',
    'GOES_ABI_C09_BrightnessTemp',
    'GOES_ABI_C10_BrightnessTemp',
    'GOES_ABI_C11_BrightnessTemp',
    'GOES_ABI_C12_BrightnessTemp',
    'GOES_ABI_C13_BrightnessTemp',
    'GOES_ABI_C14_BrightnessTemp',
    'GOES_ABI_C15_BrightnessTemp',
    'GOES_ABI_C16_BrightnessTemp',
] as const;

export type GoesProductId = typeof GOES_PRODUCTS[number];

export const GOES_PRODUCT_LABELS: Record<GoesProductId, string> = {
    'GOES_ABI_C01_Reflectance': 'Visible Blue',
    'GOES_ABI_C02_Reflectance': 'Visible Red',
    'GOES_ABI_C03_Reflectance': 'Near-Infrared Vegetation',
    'GOES_ABI_C04_Reflectance': 'Cirrus',
    'GOES_ABI_C05_Reflectance': 'Snow / Ice',
    'GOES_ABI_C06_Reflectance': 'Cloud Particle Size',
    'GOES_ABI_C07_BrightnessTemp': 'Shortwave Infrared',
    'GOES_ABI_C08_BrightnessTemp': 'Upper-Level Water Vapor',
    'GOES_ABI_C09_BrightnessTemp': 'Mid-Level Water Vapor',
    'GOES_ABI_C10_BrightnessTemp': 'Lower-Level Water Vapor',
    'GOES_ABI_C11_BrightnessTemp': 'Cloud Top Phase',
    'GOES_ABI_C12_BrightnessTemp': 'Ozone',
    'GOES_ABI_C13_BrightnessTemp': 'Clean Longwave Infrared',
    'GOES_ABI_C14_BrightnessTemp': 'Longwave Infrared',
    'GOES_ABI_C15_BrightnessTemp': 'Dirty Longwave Infrared',
    'GOES_ABI_C16_BrightnessTemp': 'Carbon Dioxide',
};

/** Readable chip names; the ABI band code remains searchable through the product ID. */
export const GOES_PRODUCT_SHORT_LABELS = GOES_PRODUCT_LABELS;

export const GOES_PRODUCT_DESCRIPTIONS: Partial<Record<GoesProductId, string>> = {
    'GOES_ABI_C01_Reflectance': 'GOES-East Band 1 visible blue imagery',
    'GOES_ABI_C02_Reflectance': 'GOES-East Band 2 visible red imagery at 0.5 km resolution',
    'GOES_ABI_C03_Reflectance': 'GOES-East Band 3 veggie / near-infrared imagery',
    'GOES_ABI_C04_Reflectance': 'GOES-East Band 4 cirrus near-infrared imagery',
    'GOES_ABI_C05_Reflectance': 'GOES-East Band 5 snow/ice near-infrared imagery',
    'GOES_ABI_C06_Reflectance': 'GOES-East Band 6 particle size near-infrared imagery',
    'GOES_ABI_C07_BrightnessTemp': 'GOES-East Band 7 shortwave infrared imagery',
    'GOES_ABI_C08_BrightnessTemp': 'GOES-East Band 8 upper-level water vapor imagery',
    'GOES_ABI_C09_BrightnessTemp': 'GOES-East Band 9 mid-level water vapor imagery',
    'GOES_ABI_C10_BrightnessTemp': 'GOES-East Band 10 lower-level water vapor imagery',
    'GOES_ABI_C11_BrightnessTemp': 'GOES-East Band 11 cloud top phase imagery',
    'GOES_ABI_C12_BrightnessTemp': 'GOES-East Band 12 ozone imagery',
    'GOES_ABI_C13_BrightnessTemp': 'GOES-East Band 13 clean longwave infrared imagery',
    'GOES_ABI_C14_BrightnessTemp': 'GOES-East Band 14 longwave infrared imagery',
    'GOES_ABI_C15_BrightnessTemp': 'GOES-East Band 15 dirty longwave infrared imagery',
    'GOES_ABI_C16_BrightnessTemp': 'GOES-East Band 16 CO₂ longwave infrared imagery',
};

export const GOES_REFLECTANCE_PRODUCTS: GoesProductId[] = GOES_PRODUCTS.filter(
    (id): id is GoesProductId => id.endsWith('_Reflectance')
);

export const GOES_BRIGHTNESS_TEMP_PRODUCTS: GoesProductId[] = GOES_PRODUCTS.filter(
    (id): id is GoesProductId => id.endsWith('_BrightnessTemp')
);

/** Where a band's pixels come from. Product IDs are unchanged from EWMRS, so saved state keeps working. */
export interface GoesBand {
    id: GoesProductId;
    band: number;
    /** Native pixel size at the sub-satellite point. The same in every sector. */
    nativeKm: 0.5 | 1 | 2;
    kind: 'reflectance' | 'brightnessTemp';
    /** Colormap key, matched by `findColormapByKey` from `/colormap`. */
    colormap: string;
    /**
     * File units to display units. CMIP stores reflectance factor and kelvin, which is what the bundled
     * colormaps (0..1.2 and K) and today's EWMRS products use, so every band is the identity.
     */
    transform: { mul: number; add: number };
    /** Pixels are drawn nearest-texel, never blended. */
    interpolate: false;
}

export type GoesSectorId = 'C' | 'F' | 'M1' | 'M2';

export interface GoesSector {
    id: GoesSectorId;
    label: string;
    /** Mesoscale boxes move and pause; CONUS and Full Disk are fixed and always scanned. */
    meso: boolean;
    /** Bucket directory, e.g. `ABI-L2-CMIPC`. */
    product: string;
    /** File-name stem after `OR_ABI-L2-`, e.g. `CMIPM1`. */
    fileStem: string;
    /** The all-band 2 km file used for zoomed-out 0.5 and 1 km bands, or null to always read the band's file. */
    mcmip: { product: string; fileStem: string } | null;
    cadenceMin: number;
}

export const GOES_SECTORS: readonly GoesSector[] = [
    { id: 'C', label: 'CONUS', meso: false, product: 'ABI-L2-CMIPC', fileStem: 'CMIPC', mcmip: { product: 'ABI-L2-MCMIPC', fileStem: 'MCMIPC' }, cadenceMin: 5 },
    // Full Disk: 24 MB (2 km) to 347 MB (C02) per band, every 10 min. MCMIPF is 326 MB but is only ever range-read.
    { id: 'F', label: 'Full Disk', meso: false, product: 'ABI-L2-CMIPF', fileStem: 'CMIPF', mcmip: { product: 'ABI-L2-MCMIPF', fileStem: 'MCMIPF' }, cadenceMin: 10 },
    // Mesoscale files (<= 4.3 MB) are smaller than MCMIPM, so they never use it.
    { id: 'M1', label: 'Mesoscale 1', meso: true, product: 'ABI-L2-CMIPM', fileStem: 'CMIPM1', mcmip: null, cadenceMin: 1 },
    { id: 'M2', label: 'Mesoscale 2', meso: true, product: 'ABI-L2-CMIPM', fileStem: 'CMIPM2', mcmip: null, cadenceMin: 1 },
];

export const DEFAULT_GOES_SECTOR: GoesSectorId = 'C';

export const isGoesSectorId = (value: unknown): value is GoesSectorId => GOES_SECTORS.some((s) => s.id === value);

export function getGoesSector(id: GoesSectorId): GoesSector {
    return GOES_SECTORS.find((s) => s.id === id) ?? GOES_SECTORS[0];
}

const NATIVE_KM: Record<number, 0.5 | 1 | 2> = { 1: 1, 2: 0.5, 3: 1, 5: 1 };

function colormapFor(band: number): string {
    if (band <= 6) return 'GOES_RGB_Raw';
    if (band >= 13 && band <= 15) return 'GOES_IR';
    return `GOES_ABI_C${String(band).padStart(2, '0')}`;
}

export const GOES_BANDS: readonly GoesBand[] = GOES_PRODUCTS.map((id) => {
    const band = Number(id.slice('GOES_ABI_C'.length, 'GOES_ABI_C'.length + 2));
    return {
        id, band, nativeKm: NATIVE_KM[band] ?? 2,
        kind: id.endsWith('_Reflectance') ? 'reflectance' : 'brightnessTemp',
        colormap: colormapFor(band),
        transform: { mul: 1, add: 0 },
        interpolate: false,
    } satisfies GoesBand;
});

export function getGoesBand(id: string): GoesBand | undefined {
    return GOES_BANDS.find((b) => b.id === id);
}

export const isGoesBandId = (id: string): id is GoesProductId => GOES_BANDS.some((b) => b.id === id);

/** Two-digit channel, e.g. `C13`. */
export const channelOf = (band: GoesBand): string => `C${String(band.band).padStart(2, '0')}`;

/** Coarsest pyramid level: one texel spans 32 km (C02 level 6, 1 km bands level 5, 2 km bands level 4). */
export const topLevel = (band: GoesBand): number => Math.round(Math.log2(32 / band.nativeKm));

/**
 * Levels from `nativeKm * 2^level >= 2 km` read MCMIP when the sector has one and the band is finer than
 * 2 km. Returns how many levels MCMIP's grid sits above the band's (0 when the band's own file is used).
 */
export function mcmipShift(band: GoesBand, sector: GoesSector, level: number): number {
    if (!sector.mcmip || band.nativeKm >= 2) return 0;
    const shift = Math.round(Math.log2(2 / band.nativeKm));
    return level >= shift ? shift : 0;
}

/** The map-facing frame key: band plus sector, so tiles and timelines never mix sectors. */
export const goesFrameKey = (bandId: string, sector: GoesSectorId): string => `${bandId}@${sector}`;
