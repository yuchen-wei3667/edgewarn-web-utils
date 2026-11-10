/** What the two GEFS configs (`datasets/gefs.ts`, `datasets/gefs-35d.ts`) share: the files, the grid and the fields of the 0.5 degree `a` set. Not a model, so it sits outside `datasets/`. */
import { pad, type ModelFieldConfig } from './types.ts';
import { HRRR_MSLP, HRRR_RH_2M, HRRR_TMP_2M, HRRR_WIND_10M } from './fields/surface.ts';
import { PRESSURE_LEVEL_FIELDS, pressureFields } from './fields/pressure.ts';
import { HRRR_SNOD, HRRR_WEASD } from './fields/winter.ts';
import { HRRR_PWAT } from './fields/precip.ts';

/** The `a` set holds relative humidity on pressure levels, not dewpoint. */
const NO_DEWPOINT = Object.values(PRESSURE_LEVEL_FIELDS).map((level) => level.dpt);

/** Everything the `a` set carries except precipitation, whose accumulation window differs by step and is added by each config. */
export const GEFS_FIELDS_BEFORE_PRECIPITATION: readonly ModelFieldConfig[] = [
    HRRR_TMP_2M,
    HRRR_RH_2M,
    HRRR_MSLP,
    HRRR_WIND_10M,
    ...pressureFields(NO_DEWPOINT),
    HRRR_SNOD,
    HRRR_WEASD,
    HRRR_PWAT,
];

/** `gec00` is the control, `gep01`..`gep30` the perturbed members. */
const memberPrefix = (member: number | undefined): string => (member ? `gep${pad(member, 2)}` : 'gec00');

const gefsObject = (prefix: (member: number | undefined) => string) => ({
    serves: ['sfc', 'prs'] as const,
    url: ({ date, cycle, step, member }: { date: string; cycle: number; step: number; member?: number }) =>
        `gefs.${date}/${pad(cycle, 2)}/atmos/pgrb2ap5/${prefix(member)}.t${pad(cycle, 2)}z.pgrb2a.0p50.f${pad(step, 3)}`,
});

/** The three objects of every GEFS dataset: the published mean and spread, and one file per member. */
export const GEFS_OBJECTS = {
    avg: gefsObject(() => 'geavg'),
    spr: gefsObject(() => 'gespr'),
    member: gefsObject(memberPrefix),
};

export const GEFS_GRID = {
    projection: 'latlon',
    nx: 720,
    ny: 361,
    lat1: 90,
    lon1: 0,
    dlat: 0.5,
    dlon: 0.5,
    scanMode: 0x00,
    radiusM: 6371229,
} as const;
