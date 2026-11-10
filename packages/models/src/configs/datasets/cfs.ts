import { defineDataset, defineField, pad } from '../types.ts';
import { CFS_BUCKET } from '../shared.ts';
import { K_TO_C, sfc } from '../fields/selectors.ts';
import { HRRR_DPT_2M, HRRR_MSLP, HRRR_RH_2M } from '../fields/surface.ts';
import { PRESSURE_LEVEL_FIELDS, pressureFields } from '../fields/pressure.ts';
import { HRRR_FRZLVL, HRRR_SBCAPE, HRRR_SBCIN, HRRR_SRH_01KM, HRRR_SRH_03KM } from '../fields/severe.ts';
import { APCP_6H } from '../fields/precip.ts';

/** CFS publishes no dewpoint on pressure levels, so those fields are left out. */
const NO_DEWPOINT = Object.values(PRESSURE_LEVEL_FIELDS).map((level) => level.dpt);

/**
 * CFS has no 2 m temperature and no 10 m wind in its pgb files. The lowest model level (sigma 0.995) is the
 * nearest it carries, so these fields say so instead of borrowing the 2 m or 10 m names.
 */
const CFS_TMP_LOWEST = defineField({
    id: 'CFS_TMP_LOWEST',
    label: 'Lowest Level Temperature (0.995 sigma)',
    pane: 'surface',
    kind: 'scalar',
    units: '°C',
    quantity: 'temperature',
    inputs: [sfc('TMP', '0.995 sigma level', { transform: K_TO_C })],
    colormap: { name: 'RAP_Temperature_LL', toStored: K_TO_C },
});

const CFS_WIND_LOWEST = defineField({
    id: 'CFS_WIND_LOWEST',
    label: 'Lowest Level Wind (0.995 sigma)',
    pane: 'surface',
    kind: 'vector',
    recipe: 'vector',
    recipeParams: { frame: 'grid' },
    units: 'm/s',
    ratioScale: true,
    quantity: 'speed',
    inputs: [sfc('UGRD', '0.995 sigma level'), sfc('VGRD', '0.995 sigma level')],
    colormap: { name: 'RAP_Wind_LL' },
});

/**
 * The pgb file for valid time `cycle + step` hours: CFS names each file by its valid time, so the hours are added
 * with Date.UTC (which carries the day rollover). Member 01 only: the cycle also holds members 02 to 04 in
 * `6hrly_grib_02` to `04`, which this config does not read.
 */
const pgbfPath = ({ date, cycle, step }: { date: string; cycle: number; step: number }): string => {
    const valid = new Date(
        Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8), cycle + step),
    );
    const stamp = `${valid.getUTCFullYear()}${pad(valid.getUTCMonth() + 1, 2)}${pad(valid.getUTCDate(), 2)}${pad(valid.getUTCHours(), 2)}`;
    return `cfs.${date}/${pad(cycle, 2)}/6hrly_grib_01/pgbf${stamp}.01.${date}${pad(cycle, 2)}.grb2`;
};

/**
 * NOAA CFS v2, the Climate Forecast System, 1 degree global, pressure-level and near-surface fields from the
 * `pgbf` files (the `flxf` files are on a Gaussian grid and are not read). Four members per cycle; this config
 * reads member 01 only. One 6-hourly file per valid time, to about 6 months from each cycle, with the end
 * depending on the cycle and the run date. Viewer-only.
 */
export const cfs = defineDataset({
    id: 'cfs',
    label: 'CFS',
    shortLabel: 'CFS',
    docs: {
        runs: '00, 06, 12 and 18 UTC',
        length: 'Every 6 hours to about 6 months (4350 to 4368 hours by cycle in the 2026-10-31 run)',
    },
    about: { provider: 'NOAA', category: 'climate' },
    access: { corsVerifiedOn: '2026-11-01' },
    source: { kind: 'grib2-index', dialect: 'wgrib2', jpeg2000: true },
    surfaces: ['viewer'],
    bucket: CFS_BUCKET,
    objects: {
        pgbf: {
            serves: ['sfc', 'prs'],
            url: pgbfPath,
        },
    },
    gate: ['pgbf'],
    products: [{ id: 'mean', label: 'Deterministic' }],
    cycles: [0, 6, 12, 18],
    // Analysis at f000, then 6-hourly files; `idxUnit` hour labels every component `N hour fcst`.
    time: { stepMinutes: 60, idxUnit: 'hour', firstStep: 0, fileIndex: { kind: 'forecast-hour' } },
    // Measured 2026-10-31 (member 01): 729, 728, 727 and 726 files; the last valid time is 4368, 4362, 4356 and 4350 hours.
    runs: [
        { cycles: [0], steps: [{ from: 0, to: 4368 * 60, every: 360 }] },
        { cycles: [6], steps: [{ from: 0, to: 4362 * 60, every: 360 }] },
        { cycles: [12], steps: [{ from: 0, to: 4356 * 60, every: 360 }] },
        { cycles: [18], steps: [{ from: 0, to: 4350 * 60, every: 360 }] },
    ],
    grid: {
        projection: 'latlon',
        nx: 360,
        ny: 181,
        lat1: 90,
        lon1: 0,
        dlat: 1,
        dlon: 1,
        scanMode: 0x00,
        radiusM: 6371229,
    },
    // 1 degree is 111.2 km at the equator, so the three levels merge 1, 2 and 4 cells.
    levelTargetsKm: [111, 222, 444],
    idx: { variables: { MSLMA: 'PRMSL' } },
    defaultField: CFS_TMP_LOWEST,
    isobars: { field: HRRR_MSLP },
    fields: [
        CFS_TMP_LOWEST,
        CFS_WIND_LOWEST,
        HRRR_DPT_2M,
        HRRR_RH_2M,
        HRRR_MSLP,
        ...pressureFields(NO_DEWPOINT),
        HRRR_SBCAPE,
        HRRR_SBCIN,
        HRRR_SRH_01KM,
        HRRR_SRH_03KM,
        HRRR_FRZLVL,
        APCP_6H,
    ],
    // The six-hour precipitation window is labelled `N-6 to N hour acc` only from f006 to f1530 (measured in all four cycles);
    // from f1536 the component is an instantaneous `N hour fcst`, so the window does not apply there.
    fieldSteps: { APCP_6H: [{ from: 6 * 60, to: 1530 * 60, every: 360 }] },
});
