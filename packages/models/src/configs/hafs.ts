/** What HAFS-A and HAFS-B share: they differ only in the bucket prefix and the label. Not a model. */
import { defineDataset, pad, type ModelUrlParams } from './types.ts';
import { HAFS_BUCKET, RRFS_LEVELS } from './shared.ts';
import { stormPathId } from './hafsStorm.ts';
import {
    HRRR_DPT_2M,
    HRRR_GUST_SFC,
    HRRR_MSLP,
    HRRR_RH_2M,
    HRRR_THETAE_2M,
    HRRR_TMP_2M,
    HRRR_TMP_SFC,
    HRRR_WIND_10M,
} from './fields/surface.ts';
import { HRRR_REFC, HRRR_SBCAPE, HRRR_SBCIN, HRRR_SRH_03KM } from './fields/severe.ts';
import { HRRR_PWAT } from './fields/precip.ts';
import { HAFS_SAT_IR, HAFS_SAT_WV_LOWER, HAFS_SAT_WV_MID, HAFS_SAT_WV_UPPER } from './fields/satellite.ts';
import { HRRR_ABSV_500MB, PRESSURE_LEVEL_FIELDS, pressureFields } from './fields/pressure.ts';

/** The nest carries pressure-level dewpoint at only six levels, none of the ones the picker lists, so those fields are left out. */
const NO_DEWPOINT = Object.values(PRESSURE_LEVEL_FIELDS).map((level) => level.dpt);

/** The storm nest's atmosphere (`atm`) or simulated-satellite (`sat`) object of one forecast hour. */
const stormObject =
    (prefix: string, kind: 'atm' | 'sat') =>
    ({ date, cycle, step }: ModelUrlParams): string => {
        const hh = pad(cycle, 2);
        return `${prefix}/${date}/${hh}/${stormPathId()}.${date}${hh}.${prefix}.storm.${kind}.f${pad(step, 3)}.grb2`;
    };

/**
 * The storm-following nest (`storm.atm`, 0.02 degrees). The grid below is the nest's shape only (`movingGrid`): its
 * corner moves with the storm every cycle and every forecast hour, so each frame carries the grid its own message declares.
 * Every cycle is 126 hours at 3-hour steps.
 */
export function defineHafs(prefix: 'hfsa' | 'hfsb', id: string, label: string) {
    return defineDataset({
        id,
        label,
        shortLabel: label,
        docs: { runs: '00, 06, 12 and 18 UTC, while a storm is active', length: '126 hours, every 3 hours' },
        about: { provider: 'NOAA', category: 'hurricane' },
        access: { corsVerifiedOn: '2026-10-31' },
        surfaces: ['viewer'],
        bucket: HAFS_BUCKET,
        objects: {
            storm: { serves: ['sfc', 'prs'], url: stormObject(prefix, 'atm') },
            sat: { serves: ['sat'], url: stormObject(prefix, 'sat') },
        },
        gate: ['storm'],
        products: [{ id: 'mean', label: 'Deterministic' }],
        cycles: [0, 6, 12, 18],
        time: { stepMinutes: 180, idxUnit: 'hour', firstStep: 0, fileIndex: { kind: 'forecast-hour' } },
        runs: [{ steps: [{ from: 0, to: 126 * 60, every: 180 }] }],
        // Shape only: the corner (10 N, 270 E) is a placeholder, and the files carry 0.019999 where this says 0.02.
        grid: {
            projection: 'latlon',
            nx: 1001,
            ny: 801,
            lat1: 10,
            lon1: 270,
            dlat: 0.02,
            dlon: 0.02,
            scanMode: 0x40,
            radiusM: 6371229,
        },
        movingGrid: true,
        // 0.02 degrees is 2.2 km, so the three levels are 2.5, 5 and 10 km.
        levelTargetsKm: [2.5, 5, 10],
        idx: { variables: { MSLMA: 'PRMSL' }, levels: RRFS_LEVELS },
        defaultField: HRRR_WIND_10M,
        isobars: { field: HRRR_MSLP },
        fields: [
            HRRR_WIND_10M,
            HRRR_MSLP,
            HRRR_REFC,
            HRRR_GUST_SFC,
            HRRR_TMP_2M,
            HRRR_DPT_2M,
            HRRR_RH_2M,
            HRRR_TMP_SFC,
            HRRR_THETAE_2M,
            ...pressureFields(NO_DEWPOINT),
            HRRR_ABSV_500MB,
            HRRR_SBCAPE,
            HRRR_SBCIN,
            HRRR_SRH_03KM,
            HRRR_PWAT,
            HAFS_SAT_IR,
            HAFS_SAT_WV_UPPER,
            HAFS_SAT_WV_MID,
            HAFS_SAT_WV_LOWER,
        ],
    });
}
