import { getGoesBand } from './catalog.ts';
import type { GoesBand, GoesProductId } from './catalog.ts';

/**
 * Client-side ABI RGB composites. Each is drawn on a 2 km base pyramid (the coarsest component grid):
 * composite level L reads band level L + log2(2 / nativeKm), so every component tile covers the same
 * ground and the texels line up one to one. The recipe runs once per tile in a fusion pass that writes
 * an RGBA8 texture, after which the 16-bit component tiles are freed.
 */
export const GOES_RGB_PRODUCTS = [
    'GOES_RGB_TrueColor',
    'GOES_RGB_Airmass',
    'GOES_RGB_DayCloudPhase',
    'GOES_RGB_Sandwich',
    'GOES_RGB_NightMicrophysics',
    'GOES_RGB_SimpleWaterVapor',
] as const;

export type GoesRgbProductId = typeof GOES_RGB_PRODUCTS[number];

export interface GoesComposite {
    id: GoesRgbProductId;
    label: string;
    /** Chip text in the layer picker. */
    shortLabel: string;
    description: string;
    /** Component bands, bound to `u_b0`..`u_b3` in this order. */
    bands: GoesProductId[];
    /**
     * GLSL body of `vec3 recipe(float b0, ...)`: inputs are physical values (reflectance factor or
     * kelvin), the result is display RGB in 0..1.
     */
    glsl: string;
    /** The recipe reads `g_sunCos`, the cosine of the solar zenith angle at the texel (scan start time). */
    solar?: boolean;
}

/** Linear stretch of `v` from `lo` to `hi` onto 0..1 (inverted when hi < lo). */
const S = 'float s(float v, float lo, float hi) { return clamp((v - lo) / (hi - lo), 0.0, 1.0); }';
export const GOES_COMPOSITE_HELPERS = S;

export const GOES_COMPOSITES: readonly GoesComposite[] = [
    {
        id: 'GOES_RGB_TrueColor',
        label: 'True Color',
        shortLabel: 'True color',
        description: 'Natural color from bands 1, 2 and 3 by day (CIMSS synthetic green), band 13 clouds by night',
        bands: ['GOES_ABI_C01_Reflectance', 'GOES_ABI_C02_Reflectance', 'GOES_ABI_C03_Reflectance', 'GOES_ABI_C13_BrightnessTemp'],
        solar: true,
        glsl: `
            float r = clamp(b1, 0.0, 1.0), b = clamp(b0, 0.0, 1.0), nir = clamp(b2, 0.0, 1.0);
            float g = clamp(0.45 * r + 0.1 * nir + 0.45 * b, 0.0, 1.0);
            vec3 day = pow(vec3(r, g, b), vec3(1.0 / 2.2));
            // Night: clean-window IR, cold cloud tops bright over a dark surface.
            vec3 night = vec3(s(b3, 290.0, 210.0));
            // Pure day up to the terminator (solar zenith 90 deg); past it the IR eases in (quadratic)
            // until full night at 100 deg (cos = -0.1736).
            float t = s(g_sunCos, 0.0, -0.1736);
            return mix(day, night, t * t);`,
    },
    {
        id: 'GOES_RGB_Airmass',
        label: 'Airmass RGB',
        shortLabel: 'Airmass',
        description: 'Jet streaks, dry intrusions and air mass temperature and moisture from bands 8, 10, 12 and 13',
        bands: ['GOES_ABI_C08_BrightnessTemp', 'GOES_ABI_C10_BrightnessTemp', 'GOES_ABI_C12_BrightnessTemp', 'GOES_ABI_C13_BrightnessTemp'],
        glsl: `
            return vec3(s(b0 - b1, -26.2, 0.6), s(b2 - b3, -43.2, 6.7), s(b0, 243.9, 208.5));`,
    },
    {
        id: 'GOES_RGB_DayCloudPhase',
        label: 'Day Cloud Phase',
        shortLabel: 'Day cloud phase',
        description: 'Daytime ice versus water cloud tops from bands 13, 2 and 5',
        bands: ['GOES_ABI_C13_BrightnessTemp', 'GOES_ABI_C02_Reflectance', 'GOES_ABI_C05_Reflectance'],
        glsl: `
            return vec3(s(b0, 280.65, 219.65), s(b1, 0.0, 0.78), s(b2, 0.01, 0.59));`,
    },
    {
        id: 'GOES_RGB_Sandwich',
        label: 'Sandwich RGB',
        shortLabel: 'Sandwich',
        description: 'Daytime band 3 visible texture multiplied with colorized band 13 cloud-top temperature',
        bands: ['GOES_ABI_C03_Reflectance', 'GOES_ABI_C13_BrightnessTemp'],
        glsl: `
            float vis = pow(clamp(b0, 0.0, 1.0), 1.0 / 1.4);
            // Cold tops from 240 K down to 190 K run blue, cyan, green, yellow, red; warmer stays white.
            float t = s(b1, 240.0, 190.0);
            vec3 ir = t <= 0.0 ? vec3(1.0)
                : t < 0.25 ? mix(vec3(0.2, 0.4, 1.0), vec3(0.0, 1.0, 1.0), t / 0.25)
                : t < 0.5 ? mix(vec3(0.0, 1.0, 1.0), vec3(0.2, 1.0, 0.2), (t - 0.25) / 0.25)
                : t < 0.75 ? mix(vec3(0.2, 1.0, 0.2), vec3(1.0, 1.0, 0.0), (t - 0.5) / 0.25)
                : mix(vec3(1.0, 1.0, 0.0), vec3(1.0, 0.1, 0.1), (t - 0.75) / 0.25);
            return vis * ir;`,
    },
    {
        id: 'GOES_RGB_NightMicrophysics',
        label: 'NT Microphysics',
        shortLabel: 'Night micro',
        description: 'Nighttime fog, low stratus and cloud phase from bands 7, 13 and 15',
        bands: ['GOES_ABI_C07_BrightnessTemp', 'GOES_ABI_C13_BrightnessTemp', 'GOES_ABI_C15_BrightnessTemp'],
        glsl: `
            return vec3(s(b2 - b1, -6.7, 2.6), s(b1 - b0, -3.1, 5.2), s(b1, 243.55, 292.65));`,
    },
    {
        id: 'GOES_RGB_SimpleWaterVapor',
        label: 'Simple WV',
        shortLabel: 'Simple WV',
        description: 'Upper and lower-level water vapor with cloud tops from bands 13, 8 and 10 (CIRA recipe)',
        bands: ['GOES_ABI_C13_BrightnessTemp', 'GOES_ABI_C08_BrightnessTemp', 'GOES_ABI_C10_BrightnessTemp'],
        glsl: `
            return vec3(s(b0, 278.96, 202.29), s(b1, 242.67, 214.66), s(b2, 261.03, 245.12));`,
    },
];

export const isGoesCompositeId = (id: string): id is GoesRgbProductId => (GOES_RGB_PRODUCTS as readonly string[]).includes(id);

export function getGoesComposite(id: string): GoesComposite | undefined {
    return GOES_COMPOSITES.find((c) => c.id === id);
}

export function compositeBands(composite: GoesComposite): GoesBand[] {
    return composite.bands.map((id) => getGoesBand(id)!);
}

/** The composite's pyramid is 2 km at level 0. */
const COMPOSITE_BASE_KM = 2;
/** Coarsest composite level: one texel spans 32 km, like every band's top level. */
export const COMPOSITE_TOP_LEVEL = Math.round(Math.log2(32 / COMPOSITE_BASE_KM));

/** Levels a band's pyramid sits below the composite's: composite level L reads band level L + this. */
export const bandLevelOffset = (band: GoesBand): number => Math.round(Math.log2(COMPOSITE_BASE_KM / band.nativeKm));

/**
 * Sub-solar point in radians (NOAA's low-precision solar position, within about 0.01 degrees),
 * so the fusion shader can find the solar zenith angle at every texel.
 *
 * `/geo` `solarPosition` answers a different question (altitude and azimuth at a place), so this is
 * not a duplicate. The decoders package cannot import `/geo` in any case.
 */
export function subsolarPoint(date: Date): { lat: number; lon: number } {
    const d = date.getTime() / 86_400_000 - 10_957.5; // days since J2000.0
    const rad = Math.PI / 180;
    const g = (357.529 + 0.98560028 * d) * rad;
    const q = 280.459 + 0.98564736 * d;
    const lambda = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
    const e = (23.439 - 0.00000036 * d) * rad;
    const ra = Math.atan2(Math.cos(e) * Math.sin(lambda), Math.cos(lambda));
    const dec = Math.asin(Math.sin(e) * Math.sin(lambda));
    const gmst = ((18.697374558 + 24.06570982441908 * d) % 24) * 15 * rad;
    let lon = ra - gmst;
    lon = Math.atan2(Math.sin(lon), Math.cos(lon));
    return { lat: dec, lon };
}
