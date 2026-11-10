import { defineDataset, pad } from '../types.ts';
import { ECMWF_BUCKET } from '../shared.ts';
import { ECMWF_PHYSICS_ALIASES, ECMWF_STEPS_3H, ECMWF_SURFACE_ALIASES } from '../ecmwf.ts';
import {
    HRRR_DPT_2M,
    HRRR_GUST_SFC,
    HRRR_MSLP,
    HRRR_TCDC,
    HRRR_TMP_2M,
    HRRR_TMP_SFC,
    HRRR_WIND_10M,
} from '../fields/surface.ts';
import { PRESSURE_LEVEL_FIELDS, pressureFields } from '../fields/pressure.ts';
import { HRRR_MUCAPE } from '../fields/severe.ts';
import { HRRR_WEASD, SNOWFALL_WE_TOTAL } from '../fields/winter.ts';
import { APCP_TOTAL, HRRR_PRATE, HRRR_PWAT } from '../fields/precip.ts';
import { PRESSURE_LEVEL_DIAGNOSTICS } from '../fields/diagnostics.ts';

/** The open data holds relative humidity on pressure levels, not dewpoint. */
const NO_DEWPOINT = Object.values(PRESSURE_LEVEL_FIELDS).map((level) => level.dpt);
const IFS_ENS_FIELDS = [
    HRRR_TMP_2M,
    HRRR_DPT_2M,
    HRRR_TMP_SFC,
    HRRR_MSLP,
    HRRR_WIND_10M,
    HRRR_GUST_SFC,
    HRRR_TCDC,
    ...pressureFields(NO_DEWPOINT),
    HRRR_MUCAPE,
    HRRR_WEASD,
    SNOWFALL_WE_TOTAL,
    HRRR_PRATE,
    HRRR_PWAT,
    APCP_TOTAL,
];
// The open-data `es` subset publishes only these scalar field families.
const IFS_NORMALIZED_SPREAD_FIELDS = ['HRRR_TMP_250MB', 'HRRR_TMP_500MB', 'HRRR_TMP_850MB', 'HRRR_HGT_500MB'];

/**
 * ECMWF IFS ENS, the open-data 0.25 degree ensemble: 50 perturbed members (no control is published) in one object per
 * step, told apart by the `number` in the JSON `.index`. Published `em`/`es` products are preferred where available;
 * other fields and cycles fall back to member reduction. Read through the
 * `ecmwf` addon. Viewer-only.
 */
export const ecmwfIfsEns = defineDataset({
    id: 'ecmwf-ifs-ens',
    label: 'ECMWF IFS ENS',
    shortLabel: 'IFS ENS',
    docs: {
        runs: '00, 06, 12 and 18 UTC',
        length: '360 hours from 00 and 12 UTC, 144 hours from 06 and 18 UTC: every 3 hours to 144, then every 6',
    },
    about: {
        provider: 'ECMWF',
        category: 'ensemble',
        attribution: 'Contains ECMWF open data, licensed CC BY 4.0',
    },
    access: { corsVerifiedOn: '2026-10-26' },
    surfaces: ['viewer'],
    source: { kind: 'grib2-index', dialect: 'ecmwf' },
    bucket: ECMWF_BUCKET,
    objects: {
        em: {
            serves: ['sfc', 'prs'],
            url: ({ date, cycle, step }) =>
                `${date}/${pad(cycle, 2)}z/ifs/0p25/enfo/${date}${pad(cycle, 2)}0000-${step}h-enfo-em.grib2`,
        },
        es: {
            serves: ['sfc', 'prs'],
            url: ({ date, cycle, step }) =>
                `${date}/${pad(cycle, 2)}z/ifs/0p25/enfo/${date}${pad(cycle, 2)}0000-${step}h-enfo-es.grib2`,
        },
        ef: {
            serves: ['sfc', 'prs'],
            url: ({ date, cycle, step }) =>
                `${date}/${pad(cycle, 2)}z/ifs/0p25/enfo/${date}${pad(cycle, 2)}0000-${step}h-enfo-ef.grib2`,
        },
    },
    gate: ['ef'],
    products: [
        { id: 'member', label: 'Member', object: 'ef' },
        {
            id: 'mean',
            label: 'Ensemble mean',
            object: 'em',
            extra: 'ens mean',
            cycles: [0, 12],
            computed: 'mean',
        },
        { id: 'sprd', label: 'Spread', object: 'es', extra: 'ens std dev', cycles: [0, 12], computed: 'sd' },
        {
            id: 'nsprd',
            label: 'Normalized spread',
            object: 'es',
            extra: 'ens std dev',
            cycles: [0, 12],
            fields: IFS_NORMALIZED_SPREAD_FIELDS,
        },
    ],
    ensemble: { perturbed: 50, control: false, addressing: 'index', stats: 'computed' },
    cycles: [0, 6, 12, 18],
    time: { stepMinutes: 60, idxUnit: 'hour', firstStep: 0, fileIndex: { kind: 'forecast-hour' } },
    runs: [
        { cycles: [0, 12], steps: [ECMWF_STEPS_3H, { from: 150 * 60, to: 360 * 60, every: 360 }] },
        { cycles: [6, 18], steps: [ECMWF_STEPS_3H] },
    ],
    grid: {
        projection: 'latlon',
        nx: 1440,
        ny: 721,
        lat1: 90,
        lon1: 180,
        dlat: 0.25,
        dlon: 0.25,
        scanMode: 0x00,
        radiusM: 6371229,
    },
    levelTargetsKm: [28, 56, 111],
    idx: {
        defaultExtra: 'any',
        variables: { TMP: 't', HGT: 'gh', RH: 'r', UGRD: 'u', VGRD: 'v' },
        components: { ...ECMWF_SURFACE_ALIASES, ...ECMWF_PHYSICS_ALIASES },
    },
    defaultField: HRRR_TMP_2M,
    isobars: { field: HRRR_MSLP },
    fields: IFS_ENS_FIELDS,
    // An advection or a frontogenesis of the ensemble mean, spread or exceedance is not the statistic of the members' own.
    notOffered: [...PRESSURE_LEVEL_DIAGNOSTICS],
});
