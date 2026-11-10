import { defineDataset, pad } from '../types.ts';
import { ECMWF_BUCKET } from '../shared.ts';
import { AIFS_HEIGHT_ALIASES, AIFS_PRECIP_ALIASES, ECMWF_STEPS_6H, ECMWF_SURFACE_ALIASES } from '../ecmwf.ts';
import {
    HRRR_DPT_2M,
    HRRR_MSLP,
    HRRR_TCDC,
    HRRR_TMP_2M,
    HRRR_TMP_SFC,
    HRRR_WIND_10M,
} from '../fields/surface.ts';
import { PRESSURE_LEVEL_FIELDS, pressureFields } from '../fields/pressure.ts';
import { APCP_TOTAL } from '../fields/precip.ts';
import { SNOWFALL_WE_TOTAL } from '../fields/winter.ts';
import { PRESSURE_LEVEL_DIAGNOSTICS } from '../fields/diagnostics.ts';

/** AIFS publishes neither humidity nor dewpoint on pressure levels. */
const NO_HUMIDITY = Object.values(PRESSURE_LEVEL_FIELDS).flatMap((level) => [level.dpt, level.rh]);

/**
 * ECMWF AIFS ENS, the open-data 0.25 degree ensemble of ECMWF's machine-learning model: a control (`cf` object) and 50
 * perturbed members (one `pf` object told apart by the `number` in the `.index`), every 6 hours to 360 h. Statistics
 * prefer published `em`/`es` objects, falling back to members for fields not in those objects. Labelled as AI. Viewer-only.
 */
export const ecmwfAifsEns = defineDataset({
    id: 'ecmwf-aifs-ens',
    label: 'ECMWF AIFS ENS',
    shortLabel: 'AIFS ENS',
    docs: { runs: '00, 06, 12 and 18 UTC', length: '360 hours, every 6 hours' },
    about: {
        provider: 'ECMWF',
        category: 'ai',
        attribution: 'AI-generated forecast. Contains ECMWF open data, licensed CC BY 4.0',
    },
    access: { corsVerifiedOn: '2026-10-26' },
    surfaces: ['viewer'],
    source: { kind: 'grib2-index', dialect: 'ecmwf' },
    bucket: ECMWF_BUCKET,
    objects: {
        em: {
            serves: ['sfc', 'prs'],
            url: ({ date, cycle, step }) =>
                `${date}/${pad(cycle, 2)}z/aifs-ens/0p25/enfo/${date}${pad(cycle, 2)}0000-${step}h-enfo-em.grib2`,
        },
        es: {
            serves: ['sfc', 'prs'],
            url: ({ date, cycle, step }) =>
                `${date}/${pad(cycle, 2)}z/aifs-ens/0p25/enfo/${date}${pad(cycle, 2)}0000-${step}h-enfo-es.grib2`,
        },
        // The control has an object of its own; the URL of member 0 names it, every other member the shared `pf`.
        pf: {
            serves: ['sfc', 'prs'],
            url: ({ date, cycle, step, member }) =>
                `${date}/${pad(cycle, 2)}z/aifs-ens/0p25/enfo/${date}${pad(cycle, 2)}0000-${step}h-enfo-${member === 0 ? 'cf' : 'pf'}.grib2`,
        },
    },
    gate: ['pf'],
    products: [
        { id: 'member', label: 'Member', object: 'pf' },
        { id: 'mean', label: 'Ensemble mean', object: 'em', extra: 'ens mean', computed: 'mean' },
        { id: 'sprd', label: 'Spread', object: 'es', extra: 'ens std dev', computed: 'sd' },
    ],
    ensemble: { perturbed: 50, control: true, addressing: 'index', stats: 'computed' },
    cycles: [0, 6, 12, 18],
    time: { stepMinutes: 60, idxUnit: 'hour', firstStep: 0, fileIndex: { kind: 'forecast-hour' } },
    runs: [{ steps: [ECMWF_STEPS_6H] }],
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
        variables: { TMP: 't', UGRD: 'u', VGRD: 'v' },
        components: { ...ECMWF_SURFACE_ALIASES, ...AIFS_PRECIP_ALIASES, ...AIFS_HEIGHT_ALIASES },
    },
    defaultField: HRRR_TMP_2M,
    isobars: { field: HRRR_MSLP },
    fields: [
        HRRR_TMP_2M,
        HRRR_DPT_2M,
        HRRR_TMP_SFC,
        HRRR_MSLP,
        HRRR_WIND_10M,
        HRRR_TCDC,
        ...pressureFields(NO_HUMIDITY),
        APCP_TOTAL,
        SNOWFALL_WE_TOTAL,
    ],
    // An advection or a frontogenesis of the ensemble mean, spread or exceedance is not the statistic of the members' own.
    notOffered: [...PRESSURE_LEVEL_DIAGNOSTICS],
});
