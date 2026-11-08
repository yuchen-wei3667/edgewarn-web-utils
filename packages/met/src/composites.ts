/**
 * Composite indices of the sounding science core (phase 5 plan, section 5.4): significant tornado
 * parameter (fixed-layer and effective), supercell composite, significant hail parameter and the
 * energy-helicity index. Plain ports of SHARPpy `stp_fixed`/`stp_cin`/`scp`/`ship` with the SPC
 * caps held in `config/sounding.ts`; every argument may be null and nulls propagate. Nothing here
 * lifts anything: callers hand in the pieces from `parcels`, `kinematics` and `indices`.
 */

import {
    SOUNDING_STP_FIXED,
    SOUNDING_STP_EFFECTIVE,
    SOUNDING_SCP,
    SOUNDING_SHIP,
    SOUNDING_EHI_NORM,
} from './constants.ts';

/** Every argument must be a finite number for the composite to be defined. */
const given = (vs: (number | null | undefined)[]): boolean =>
    vs.every((v) => typeof v === 'number' && Number.isFinite(v));

/**
 * Thompson et al. (2003) fixed-layer significant tornado parameter: (SBCAPE/1500)·LCL·(SRH1/150)·
 * (BWD/20), with the LCL term 1 below 1000 m, 0 above 2000 m, and the BWD floor 12.5 m/s
 * (term 0) and the 30 m/s cap (term 1.5).
 */
export function stpFixed(sbCapeJkg: number | null, sbLclZaglM: number | null, srh01: number | null, shear06: number | null): number | null {
    if (!given([sbCapeJkg, sbLclZaglM, srh01, shear06])) return null;
    const lclTerm = sbLclZaglM! < SOUNDING_STP_FIXED.lclLowM
        ? 1
        : sbLclZaglM! > SOUNDING_STP_FIXED.lclHighM
            ? 0
            : (SOUNDING_STP_FIXED.lclHighM - sbLclZaglM!) / 1000;
    const shearTerm = shear06! < SOUNDING_STP_FIXED.shearFloorMs
        ? 0
        : Math.min(shear06!, SOUNDING_STP_FIXED.shearCapMs) / SOUNDING_STP_FIXED.shearNormMs;
    return (sbCapeJkg! / SOUNDING_STP_FIXED.capeNormJkg) * (srh01! / SOUNDING_STP_FIXED.srhNorm) * lclTerm * shearTerm;
}

/**
 * Thompson et al. (2012) effective-layer significant tornado parameter: (MLCAPE/1500)·
 * ((2000 − MLLCL)/1000)·(ESRH/150)·(EBWD/20)·((200 + MLCIN)/150), EBWD < 12.5 giving 0 and
 * > 30 capped at 1.5, the LCL term as above, the CIN term 1 above −50 and 0 below −200 J kg⁻¹.
 * Clamped non-negative (SHARPpy `np.maximum`).
 */
export function stpEffective(mlCapeJkg: number | null, esrh: number | null, ebwd: number | null, mlLclZaglM: number | null, mlCinJkg: number | null): number | null {
    if (!given([mlCapeJkg, esrh, ebwd, mlLclZaglM, mlCinJkg])) return null;
    const shearTerm = ebwd! < SOUNDING_STP_FIXED.shearFloorMs
        ? 0
        : Math.min(ebwd!, SOUNDING_STP_FIXED.shearCapMs) / SOUNDING_STP_FIXED.shearNormMs;
    const lclTerm = mlLclZaglM! < SOUNDING_STP_FIXED.lclLowM
        ? 1
        : mlLclZaglM! > SOUNDING_STP_FIXED.lclHighM
            ? 0
            : (SOUNDING_STP_FIXED.lclHighM - mlLclZaglM!) / 1000;
    const cinTerm = mlCinJkg! > SOUNDING_STP_EFFECTIVE.cinSatJkg
        ? 1
        : mlCinJkg! < SOUNDING_STP_EFFECTIVE.cinFloorJkg
            ? 0
            : (mlCinJkg! - SOUNDING_STP_EFFECTIVE.cinFloorJkg) / SOUNDING_STP_EFFECTIVE.cinNormJkg;
    return Math.max(
        (mlCapeJkg! / SOUNDING_STP_FIXED.capeNormJkg) * (esrh! / SOUNDING_STP_FIXED.srhNorm) * lclTerm * shearTerm * cinTerm,
        0,
    );
}

/**
 * Thompson et al. (2004) supercell composite parameter: (MUCAPE/1000)·(ESRH/50)·(EBWD/20),
 * EBWD term 0 below 10 m/s, capped at 1 above 20 m/s.
 */
export function scp(muCapeJkg: number | null, esrh: number | null, ebwd: number | null): number | null {
    if (!given([muCapeJkg, esrh, ebwd])) return null;
    let ebwdTerm = ebwd!;
    if (ebwd! < SOUNDING_SCP.shearFloorMs) ebwdTerm = 0;
    else if (ebwd! > SOUNDING_SCP.shearNormMs) ebwdTerm = SOUNDING_SCP.shearNormMs;
    return (muCapeJkg! / SOUNDING_SCP.capeNormJkg) * (esrh! / SOUNDING_SCP.srhNorm) * (ebwdTerm / SOUNDING_SCP.shearNormMs);
}

/**
 * SPC significant hail parameter (SHIP): −MUCAPE·MUr·LR75·T500·BWD06/42 000 000 with the SPC
 * adjustments (MUr clamped 11-13.6 g kg⁻¹, T500 floored at −5.5 °C, shear clamped 7-27 m/s,
 * then the MUCAPE < 1300, LR75 < 5.8 and freezing level < 2400 m multipliers). Arguments are the
 * MU parcel CAPE and mixing ratio, the 700-500 hPa lapse rate, the plain 500 hPa temperature,
 * the 0-6 km shear and the freezing level AGL.
 */
export function ship(muCapeJkg: number | null, muMixingRatioGkg: number | null, lr75: number | null, t500C: number | null, shear06: number | null, frzZaglM: number | null): number | null {
    if (!given([muCapeJkg, muMixingRatioGkg, lr75, t500C, shear06, frzZaglM])) return null;
    const mr = Math.min(Math.max(muMixingRatioGkg!, SOUNDING_SHIP.mrMinGkg), SOUNDING_SHIP.mrMaxGkg);
    const shear = Math.min(Math.max(shear06!, SOUNDING_SHIP.shearMinMs), SOUNDING_SHIP.shearMaxMs);
    const t500 = Math.min(t500C!, SOUNDING_SHIP.t500MinC);
    let value = -1 * (muCapeJkg! * mr * lr75! * t500 * shear) / SOUNDING_SHIP.denom;
    if (muCapeJkg! < SOUNDING_SHIP.mucapeMinJkg) value *= muCapeJkg! / SOUNDING_SHIP.mucapeMinJkg;
    if (lr75! < SOUNDING_SHIP.lr75MinCKm) value *= lr75! / SOUNDING_SHIP.lr75MinCKm;
    if (frzZaglM! < SOUNDING_SHIP.frzMinM) value *= frzZaglM! / SOUNDING_SHIP.frzMinM;
    return value;
}

/** Hart & Korotky (1991) energy-helicity index: CAPE·SRH/160000. */
export function ehi(capeJkg: number | null, srh: number | null): number | null {
    if (!given([capeJkg, srh])) return null;
    return capeJkg! * srh! / SOUNDING_EHI_NORM;
}
