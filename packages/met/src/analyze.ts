/**
 * Orchestration of the sounding science core (phase 5 plan, section 5.2 `analyze`): turns one
 * `Column` into the full `SoundingAnalysis` - SB/ML/MU/effective parcels, kinematics, indices and
 * composites - with everything memoised per column hash (FIFO, `SOUNDING_ANALYSIS_CACHE_SIZE`).
 * Pure, synchronous and UI-free: nothing fetches, nothing renders. A structurally empty column is
 * the only throw; missing values anywhere else become nulls by construction, NaNs never propagate
 * into the result.
 */

import {
    SOUNDING_SHEAR_LAYERS_M,
    SOUNDING_SRH_LAYERS_M,
    SOUNDING_ANALYSIS_CACHE_SIZE,
} from './constants.ts';
import { mixingRatioHpa } from './bolton.ts';
import { interpolateLogP, heightAglAt, pressureAtAgl } from './interp.ts';
import { surfaceParcelDef, meanLayerParcelDef, mostUnstableParcelDef, effectiveParcelDef, liftColumn, dcapeColumn } from './parcels.ts';
import { bulkShear, meanWind, bunkersMotion, helicity, effectiveInflowLayer, effectiveBulkShear, criticalAngle } from './kinematics.ts';
import { lapseRatePressure, lapseRateHeight, precipitableWater, kIndex, totalTotals, showalter, freezingLevelAgl, wetBulbZeroAgl, bulkRichardson, type LiftFn } from './indices.ts';
import { stpFixed, stpEffective, scp, ship, ehi } from './composites.ts';
import type { Column, ParcelResult, ParcelKey, SoundingAnalysis, AnalysisOptions, StormMotion, Vec2, LayerBounds } from './types.ts';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const emptyParcel: ParcelResult = {
    cape: null, cin: null, lclP: null, lclZagl: null, lfcP: null, lfcZagl: null,
    elP: null, elZagl: null, li: null, cape03: null, trace: [],
};

const analyseParcel = (col: Column, def: { p: number; t: number; td: number } | null): ParcelResult => {
    if (!def) return emptyParcel;
    const lift = liftColumn(col, def);
    return lift ?? emptyParcel; // LiftResult matches ParcelResult field for field
};

const finite = (v: number): boolean => Number.isFinite(v);

/** FNV-1a over the raw bits of an array, for memoisation keys. */
const hashArray = (a: Float32Array): string => {
    const u = new Uint32Array(a.buffer, a.byteOffset, a.length);
    let h = 0x811c9dc5;
    for (let i = 0; i < u.length; i++) {
        h ^= u[i] & 0xffff;
        h = Math.imul(h, 16777619);
        h ^= u[i] >>> 16;
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
};

const hashColumn = (col: Column, optionsKey: string): string =>
    [
        col.validMs,
        optionsKey,
        col.p.length,
        hashArray(col.p), hashArray(col.z), hashArray(col.t), hashArray(col.td), hashArray(col.u), hashArray(col.v),
    ].join('-');

/** Resolves the options' storm motion into a vector, defaulting to the Bunkers right mover. */
export const resolveMotion = (motion: StormMotion | undefined, bunkers: { right: Vec2 | null; left: Vec2 | null; mean06: Vec2 | null }): Vec2 | null => {
    if (!motion || motion.kind === 'bunkers-right') return bunkers.right;
    if (motion.kind === 'bunkers-left') return bunkers.left;
    if (motion.kind === 'mean-wind') return bunkers.mean06;
    if (!finite(motion.dirDeg) || !finite(motion.speedMs)) return null;
    const rad = motion.dirDeg * Math.PI / 180; // `dirDeg` is the direction the storm moves FROM
    return { u: -motion.speedMs * Math.sin(rad), v: -motion.speedMs * Math.cos(rad) };
};

/** Plain 500 hPa temperature (°C) or null when the level is missing. */
const t500 = (col: Column): number | null => {
    const t = interpolateLogP(col.p, col.t, 500);
    return finite(t) ? t : null;
};

/** A parcel lift callable handed to `indices.showalter`, avoiding a parcels→indices cycle. */
const lifter: LiftFn = (c, def) => liftColumn(c, { p: def.p, t: def.t, td: def.td })?.li ?? null;

/* ------------------------------------------------------------------ */
/* Memoisation                                                         */
/* ------------------------------------------------------------------ */

/** Result cache keyed by content hash; insertion-order eviction at the configured size. */
const cache = new Map<string, SoundingAnalysis>();

/* ------------------------------------------------------------------ */
/* The analysis                                                        */
/* ------------------------------------------------------------------ */

/**
 * Full analysis of one sounding column. Throws only on a structurally empty column; every other
 * undefined quantity (missing moisture, no LFC, a layer outside the profile) is null in the result.
 */
export function analyzeSounding(col: Column, options: AnalysisOptions = {}): SoundingAnalysis {
    if (!col || !col.p || col.p.length < 2 || col.z.length !== col.p.length) {
        throw new Error('sounding: structurally empty column');
    }
    const optionsKey = options.stormMotion ? JSON.stringify(options.stormMotion) : '';
    const key = hashColumn(col, optionsKey);
    const cached = cache.get(key);
    if (cached) return cached;

    const analysis = computeAnalysis(col, options);
    cache.set(key, analysis);
    while (cache.size > SOUNDING_ANALYSIS_CACHE_SIZE) {
        cache.delete(cache.keys().next().value as string);
    }
    return analysis;
}

function computeAnalysis(col: Column, options: AnalysisOptions): SoundingAnalysis {
    /* Parcels: SB, ML and MU; the effective-layer mean parcel joins after the layer search. */
    const sbDef = surfaceParcelDef(col);
    const mlDef = meanLayerParcelDef(col);
    const muDef = mostUnstableParcelDef(col);
    const parcels: Record<ParcelKey, ParcelResult> = {
        sb: analyseParcel(col, sbDef),
        ml: analyseParcel(col, mlDef),
        mu: analyseParcel(col, muDef),
        eff: emptyParcel,
    };

    /* Effective inflow layer and its mean parcel. */
    const effSearch = effectiveInflowLayer(col);
    let effBounds: LayerBounds | null = null;
    if (effSearch) {
        parcels.eff = analyseParcel(col, effectiveParcelDef(col, effSearch.baseP, effSearch.topP));
        effBounds = { baseP: effSearch.baseP, topP: effSearch.topP };
    }

    /* Storm motion: Bunkers pieces first, then the options' choice for the SRH rows. */
    const bunkers = bunkersMotion(col);
    const motion = resolveMotion(options.stormMotion, bunkers);

    /* Kinematics. */
    let esrh: number | null = null;
    if (effBounds && bunkers.right) {
        const baseZ = heightAglAt(col, effBounds.baseP);
        const topZ = heightAglAt(col, effBounds.topP);
        esrh = finite(baseZ) && finite(topZ) ? helicity(col, baseZ, topZ, bunkers.right) : null;
    }
    const kinematics = {
        shear01: bulkShear(col, SOUNDING_SHEAR_LAYERS_M[0]),
        shear03: bulkShear(col, SOUNDING_SHEAR_LAYERS_M[1]),
        shear06: bulkShear(col, SOUNDING_SHEAR_LAYERS_M[2]),
        ebwd: effectiveBulkShear(col, parcels.mu.elZagl, effBounds),
        meanWind06: meanWind(col, col.p[0], pressureAtAgl(col, SOUNDING_SHEAR_LAYERS_M[2]), true),
        bunkersRight: bunkers.right,
        bunkersLeft: bunkers.left,
        srh01: motion ? helicity(col, 0, SOUNDING_SRH_LAYERS_M[0], motion) : null,
        srh03: motion ? helicity(col, 0, SOUNDING_SRH_LAYERS_M[1], motion) : null,
        esrh,
        criticalAngle: motion ? criticalAngle(col, motion) : null,
        stormMotion: motion,
    };

    /* Fixed-level thermodynamics. */
    const thermo = {
        pw: precipitableWater(col),
        lr03: lapseRateHeight(col, 0, SOUNDING_SHEAR_LAYERS_M[1]),
        lr36: lapseRateHeight(col, SOUNDING_SHEAR_LAYERS_M[1], SOUNDING_SHEAR_LAYERS_M[2]),
        lr75: lapseRatePressure(col, 700, 500),
        lr85: lapseRatePressure(col, 850, 500),
        dcape: dcapeColumn(col),
        frzZagl: freezingLevelAgl(col),
        wbzZagl: wetBulbZeroAgl(col),
        k: kIndex(col),
        tt: totalTotals(col),
        showalter: showalter(col, lifter),
    };

    /* Composites from the pieces above. */
    const composites = {
        stpFixed: stpFixed(parcels.sb.cape, parcels.sb.lclZagl, kinematics.srh01, kinematics.shear06),
        stpEff: stpEffective(parcels.ml.cape, kinematics.esrh, kinematics.ebwd, parcels.ml.lclZagl, parcels.ml.cin),
        scp: scp(parcels.mu.cape, kinematics.esrh, kinematics.ebwd),
        ship: ship(
            parcels.mu.cape,
            muDef ? mixingRatioHpa(muDef.p, muDef.td) : null,
            thermo.lr75,
            t500(col),
            kinematics.shear06,
            thermo.frzZagl,
        ),
        ehi01: ehi(parcels.sb.cape, kinematics.srh01),
        ehi03: ehi(parcels.sb.cape, kinematics.srh03),
        brn: bulkRichardson(col, parcels.mu.cape),
    };

    return { parcels, layers: { effInflow: effBounds }, kinematics, thermo, composites };
}
