import { defineField } from '../types.ts';
import { K_TO_C, prs, sfc } from './selectors.ts';

/**
 * Diagnostic fields (phase 5.9): fixed fields derived from several of a model's own fields by the recipes in
 * `utils/models/diagnosticRecipes.ts`. Winds are grid-relative in the NCEP convection-allowing models; on a lat/lon grid
 * the rotation is zero, so every field says `grid`. The composites are built from the model's computed CAPE, SRH and shear
 * rather than from a parcel lifted at every cell.
 */

const DERIVED_NOTE =
    "Derived here from the model's temperature and wind by a centred difference over about 12 km; the model does not output it.";
const COMPOSITE_NOTE =
    "Built from the model's own computed CAPE, helicity and shear, not from a parcel lifted at every grid cell.";

/** Half range, °C per hour, of the temperature advection colormap at each level. */
const ADVECTION_RANGE = { 850: 6, 700: 4, 500: 3 } as const;
const FRONTOGENESIS_RANGE = 10;
const MOISTURE_FLUX_RANGE = 300;

const advection = (mb: keyof typeof ADVECTION_RANGE) =>
    defineField({
        id: `HRRR_TADV_${mb}MB`,
        label: `${mb} mb Temperature Advection (derived)`,
        pane: `${mb}`,
        kind: 'scalar',
        units: '°C/h',
        recipe: 'advection',
        recipeParams: { frame: 'grid' },
        inputs: [
            prs('TMP', `${mb} mb`, { transform: K_TO_C }),
            prs('UGRD', `${mb} mb`),
            prs('VGRD', `${mb} mb`),
        ],
        colormap: { name: 'Model_Advection', range: [-ADVECTION_RANGE[mb], ADVECTION_RANGE[mb]] },
        note: DERIVED_NOTE,
    });

const frontogenesis = (mb: 850 | 700) =>
    defineField({
        id: `HRRR_FGEN_${mb}MB`,
        label: `${mb} mb Frontogenesis (derived)`,
        pane: `${mb}`,
        kind: 'scalar',
        units: 'K/100 km/3 h',
        recipe: 'frontogenesis',
        recipeParams: { frame: 'grid', levelHpa: mb },
        inputs: [
            prs('TMP', `${mb} mb`, { transform: K_TO_C }),
            prs('UGRD', `${mb} mb`),
            prs('VGRD', `${mb} mb`),
        ],
        colormap: { name: 'Model_Advection', range: [-FRONTOGENESIS_RANGE, FRONTOGENESIS_RANGE] },
        note: `${DERIVED_NOTE} Two-dimensional Petterssen kinematic frontogenesis of potential temperature.`,
    });

const HRRR_TADV_850MB = advection(850);
const HRRR_TADV_700MB = advection(700);
const HRRR_TADV_500MB = advection(500);
const HRRR_FGEN_850MB = frontogenesis(850);
const HRRR_FGEN_700MB = frontogenesis(700);

/** Specific humidity times the wind speed at 850 mb: the size of the low-level moisture transport. */
const HRRR_QFLUX_850MB = defineField({
    id: 'HRRR_QFLUX_850MB',
    label: '850 mb Moisture Flux (derived)',
    pane: '850',
    kind: 'scalar',
    units: 'g/kg·m/s',
    ratioScale: true,
    recipe: 'moisture-flux',
    recipeParams: { frame: 'grid' },
    inputs: [
        prs('SPFH', '850 mb', { transform: { scale: 1000 } }),
        prs('UGRD', '850 mb'),
        prs('VGRD', '850 mb'),
    ],
    colormap: { name: 'HRRR_PWAT', range: [0, MOISTURE_FLUX_RANGE] },
    note: "Specific humidity times wind speed at 850 mb, from the model's own fields.",
});

/** How fast temperature falls with height between 700 and 500 mb, from the two levels' temperature and height. */
const HRRR_LAPSE_700_500 = defineField({
    id: 'HRRR_LAPSE_700_500',
    label: '700-500 mb Lapse Rate (derived)',
    pane: 'severe',
    kind: 'scalar',
    units: '°C/km',
    recipe: 'lapse-rate',
    inputs: [
        prs('TMP', '700 mb', { transform: K_TO_C }),
        prs('TMP', '500 mb', { transform: K_TO_C }),
        prs('HGT', '700 mb'),
        prs('HGT', '500 mb'),
    ],
    colormap: { name: 'Model_LapseRate', range: [4, 10] },
    note: "Temperature difference over the height difference between the model's 700 and 500 mb levels.",
});

const CAPE = sfc('CAPE', 'surface');

/** Fixed-layer significant tornado parameter (Thompson et al. 2003): SBCAPE, SB LCL height AGL, 0-1 km SRH and 0-6 km shear. */
export const HRRR_STP_FIXED = defineField({
    id: 'HRRR_STP_FIXED',
    label: 'Significant Tornado Parameter (fixed layer, derived)',
    pane: 'severe',
    kind: 'scalar',
    units: 'index',
    recipe: 'stp-fixed',
    inputs: [
        CAPE,
        sfc('HGT', 'level of adiabatic condensation from sfc'),
        sfc('HGT', 'surface'),
        sfc('HLCY', '1000-0 m above ground'),
        sfc('VUCSH', '0-6000 m above ground'),
        sfc('VVCSH', '0-6000 m above ground'),
    ],
    colormap: { name: 'RAP_CAPE', range: [0, 8] },
    note: COMPOSITE_NOTE,
});

const ehi = (layer: '01' | '03') =>
    defineField({
        id: `HRRR_EHI_${layer}KM`,
        label: `Energy-Helicity Index (0-${layer === '01' ? 1 : 3} km, derived)`,
        pane: 'severe',
        kind: 'scalar',
        units: 'index',
        recipe: 'ehi',
        inputs: [CAPE, sfc('HLCY', `${layer === '01' ? 1000 : 3000}-0 m above ground`)],
        colormap: { name: 'RAP_CAPE', range: [0, 6] },
        note: COMPOSITE_NOTE,
    });

export const HRRR_EHI_01KM = ehi('01');
export const HRRR_EHI_03KM = ehi('03');

/** The fields that need only temperature, wind, humidity and height on pressure levels. */
const BASIC_PRESSURE_LEVEL_DIAGNOSTICS = [
    HRRR_TADV_850MB,
    HRRR_TADV_700MB,
    HRRR_TADV_500MB,
    HRRR_FGEN_850MB,
    HRRR_FGEN_700MB,
    HRRR_QFLUX_850MB,
    HRRR_LAPSE_700_500,
] as const;

/* ---- Phase 5.10: transports, vorticity, quasi-geostrophic forcing, isentropic and storm-relative fields ---- */

const SURFACE_PRESSURE = sfc('PRES', 'surface', { transform: { scale: 0.01 } });
const humidity = (mb: number) => prs('SPFH', `${mb} mb`, { transform: { scale: 1000 } });
const temperature = (mb: number) => prs('TMP', `${mb} mb`, { transform: K_TO_C });
const winds = (mb: number) => [prs('UGRD', `${mb} mb`), prs('VGRD', `${mb} mb`)];

/** Levels the column integral and the isentropic interpolation read, hPa, descending. */
const COLUMN_LEVELS = [1000, 925, 850, 700, 600, 500, 400, 300] as const;
const IVT_RANGE = 2500;

/** Integrated vapour transport: the size of the vertically integrated moisture flux, 1000 hPa to 300 hPa. */
const HRRR_IVT = defineField({
    id: 'HRRR_IVT',
    label: 'Integrated Vapor Transport (derived)',
    pane: 'precip',
    kind: 'scalar',
    units: 'kg/m/s',
    ratioScale: true,
    recipe: 'ivt',
    recipeParams: { frame: 'grid', levelsHpa: COLUMN_LEVELS },
    inputs: [...COLUMN_LEVELS.flatMap((mb) => [humidity(mb), ...winds(mb)]), SURFACE_PRESSURE],
    colormap: { name: 'Model_IVT', range: [0, IVT_RANGE] },
    note: "Size of 1/g times the integral of specific humidity times wind over pressure, from the ground to 300 mb, by trapezoids over the model's 1000, 925, 850, 700, 600, 500, 400 and 300 mb levels; levels under the ground are left out.",
});

/** Layers (lower, middle, upper, hPa) whose spacing gives the vertical derivatives of potential vorticity. */
const PV_LAYERS = { 700: [850, 700, 600], 500: [600, 500, 400], 300: [400, 300, 250] } as const;
const PV_RANGE = { 700: 3, 500: 4, 300: 8 } as const;

const potentialVorticity = (mb: keyof typeof PV_LAYERS) =>
    defineField({
        id: `HRRR_PV_${mb}MB`,
        label: `${mb} mb Potential Vorticity (derived)`,
        pane: mb === 300 ? 'levels' : `${mb}`,
        kind: 'scalar',
        units: 'PVU',
        recipe: 'potential-vorticity',
        recipeParams: { frame: 'grid', levelsHpa: PV_LAYERS[mb] },
        inputs: PV_LAYERS[mb].flatMap((level) => [temperature(level), ...winds(level)]),
        colormap: { name: 'RAP_AbsoluteVorticity_500mb', range: [0, PV_RANGE[mb]] },
        note: `${DERIVED_NOTE} Ertel potential vorticity on the isobaric level, with the baroclinic term, from the levels ${PV_LAYERS[mb].join(', ')} mb.`,
    });

/** Half range of the Q-vector convergence colormap, 1e-16 m/kg/s. */
const Q_CONVERGENCE_RANGE = 10;
const Q_MAGNITUDE_RANGE = 6;

const qConvergence = (mb: 850 | 700 | 500) =>
    defineField({
        id: `HRRR_QCONV_${mb}MB`,
        label: `${mb} mb Q-Vector Convergence (derived)`,
        pane: `${mb}`,
        kind: 'scalar',
        units: '10⁻¹⁶ m/kg/s',
        recipe: 'q-vector',
        recipeParams: { frame: 'grid', levelHpa: mb, output: 'convergence' },
        inputs: [temperature(mb), ...winds(mb)],
        colormap: { name: 'Model_Advection', range: [-Q_CONVERGENCE_RANGE, Q_CONVERGENCE_RANGE] },
        note: `${DERIVED_NOTE} -2 times the divergence of Q = -(R/p)(dV/dx . grad T, dV/dy . grad T) with the model's wind, not its geostrophic wind; positive where the quasi-geostrophic forcing is for ascent.`,
    });

const HRRR_QMAG_700MB = defineField({
    id: 'HRRR_QMAG_700MB',
    label: '700 mb Q-Vector Magnitude (derived)',
    pane: '700',
    kind: 'scalar',
    units: '10⁻¹¹ m²/kg/s',
    ratioScale: true,
    recipe: 'q-vector',
    recipeParams: { frame: 'grid', levelHpa: 700, output: 'magnitude' },
    inputs: [temperature(700), ...winds(700)],
    colormap: { name: 'RAP_CAPE', range: [0, Q_MAGNITUDE_RANGE] },
    note: `${DERIVED_NOTE} Size of Q = -(R/p)(dV/dx . grad T, dV/dy . grad T) with the model's wind, not its geostrophic wind.`,
});

/** Difference of the temperature advection of a lower and an upper level: the destabilising and lifting tendency of the layer. */
const DIFFERENTIAL_RANGE = 6;
const differentialAdvection = (lower: 850 | 700) =>
    defineField({
        id: `HRRR_DTADV_${lower}_500MB`,
        label: `${lower}-500 mb Differential Temperature Advection (derived)`,
        pane: 'levels',
        kind: 'scalar',
        units: '°C/h',
        recipe: 'differential-advection',
        recipeParams: { frame: 'grid' },
        inputs: [temperature(lower), ...winds(lower), temperature(500), ...winds(500)],
        colormap: { name: 'Model_Advection', range: [-DIFFERENTIAL_RANGE, DIFFERENTIAL_RANGE] },
        note: `${DERIVED_NOTE} Temperature advection at ${lower} mb minus that at 500 mb; positive where warm advection is stronger (or cold advection weaker) below.`,
    });

const ISENTROPIC_K = 300;
const ISENTROPIC_OUTPUTS = {
    pressure: {
        label: 'Pressure',
        units: 'hPa',
        colormap: { name: 'HRRR_MSLP', range: [300, 1000] as [number, number] },
        extras: () => [],
    },
    humidity: {
        label: 'Specific Humidity',
        units: 'g/kg',
        colormap: { name: 'HRRR_PWAT', range: [0, 12] as [number, number] },
        extras: (mb: number) => [humidity(mb)],
    },
    speed: {
        label: 'Wind Speed',
        units: 'm/s',
        colormap: { name: 'RAP_Wind_ML', range: [0, 40] as [number, number] },
        extras: winds,
    },
} as const;

const isentropic = (output: keyof typeof ISENTROPIC_OUTPUTS) => {
    const o = ISENTROPIC_OUTPUTS[output];
    return defineField({
        id: `HRRR_ISEN_${ISENTROPIC_K}K_${output.toUpperCase()}`,
        label: `${ISENTROPIC_K} K Isentropic ${o.label} (derived)`,
        pane: 'levels',
        kind: 'scalar',
        units: o.units,
        ratioScale: output !== 'pressure',
        recipe: 'isentropic',
        recipeParams: { frame: 'grid', levelsHpa: COLUMN_LEVELS, thetaK: ISENTROPIC_K, output },
        inputs: [
            ...COLUMN_LEVELS.map(temperature),
            ...(output === 'speed'
                ? [...COLUMN_LEVELS.map((mb) => winds(mb)[0]), ...COLUMN_LEVELS.map((mb) => winds(mb)[1])]
                : COLUMN_LEVELS.flatMap((mb) => o.extras(mb))),
            SURFACE_PRESSURE,
        ],
        colormap: o.colormap,
        note: `Lowest ${ISENTROPIC_K} K surface above the ground, interpolated linearly in ln p between the model's 1000 to 300 mb levels; missing where the surface is under the ground or above 300 mb.`,
    });
};

/** The wind relative to the Bunkers right mover, from the profile's 0-6 km mean wind and the model's own 0-6 km shear. */
const STORM_LEVELS = [850, 700, 500, 400] as const;
const STORM_FLOW_RANGE = 40;

const stormRelative = (mb: 850 | 500) =>
    defineField({
        id: `HRRR_SRFLOW_${mb}MB`,
        label: `${mb} mb Storm-Relative Wind (derived)`,
        pane: `${mb}`,
        kind: 'scalar',
        units: 'm/s',
        ratioScale: true,
        quantity: 'speed',
        recipe: 'storm-relative',
        recipeParams: { frame: 'grid', levelsHpa: STORM_LEVELS, targetHpa: mb },
        inputs: [
            sfc('HGT', 'surface'),
            sfc('UGRD', '10 m above ground'),
            sfc('VGRD', '10 m above ground'),
            sfc('VUCSH', '0-6000 m above ground'),
            sfc('VVCSH', '0-6000 m above ground'),
            ...STORM_LEVELS.flatMap((level) => [prs('HGT', `${level} mb`), ...winds(level)]),
        ],
        colormap: { name: 'RAP_Wind_ML', range: [0, STORM_FLOW_RANGE] },
        note: "Speed of the wind at the level relative to the Bunkers right mover (the sounding page's own deviation), whose mean wind comes from the 10 m wind and the 850 to 400 mb winds at their heights above the ground.",
    });

const COLUMN_DIAGNOSTICS = [
    HRRR_IVT,
    potentialVorticity(700),
    potentialVorticity(500),
    potentialVorticity(300),
    qConvergence(850),
    qConvergence(700),
    qConvergence(500),
    HRRR_QMAG_700MB,
    differentialAdvection(850),
    differentialAdvection(700),
    isentropic('pressure'),
    isentropic('humidity'),
    isentropic('speed'),
] as const;

/** Needs the model's 0-6 km shear and its terrain height, which only some models carry. */
export const STORM_RELATIVE_DIAGNOSTICS = [stormRelative(850), stormRelative(500)] as const;

/** Every diagnostic that needs only the pressure levels and the surface pressure a global or regional model carries. */
export const PRESSURE_LEVEL_DIAGNOSTICS = [
    ...BASIC_PRESSURE_LEVEL_DIAGNOSTICS,
    ...COLUMN_DIAGNOSTICS,
] as const;
