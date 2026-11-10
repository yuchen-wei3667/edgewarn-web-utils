import { momentsOfKind } from './vcp.ts';
import type { CutKind, Vcp } from './vcp.ts';

/** A surveillance cut and the Doppler cut right after it at nearly the same nominal angle are one elevation scan. */
const PAIR_MAX_ANGLE_GAP = 0.5;

export interface ElevationComponent {
    /** The VCP cut number (the radials' elevationNumber). */
    cut: number;
    kind: CutKind;
    angle: number;
}

export interface ElevationPlan {
    /** Position in the volume; stable for a given VCP occurrence, so SAILS repeats keep separate ids. */
    id: number;
    nominalAngle: number;
    components: ElevationComponent[];
    paired: boolean;
}

export function buildElevations(vcp: Vcp): ElevationPlan[] {
    const plans: ElevationPlan[] = [];
    const cuts = vcp.cuts;
    for (let i = 0; i < cuts.length; i++) {
        const cut = cuts[i];
        const next = cuts[i + 1];
        const components: ElevationComponent[] = [{ cut: cut.number, kind: cut.kind, angle: cut.angle }];
        if (cut.kind === 'S' && next?.kind === 'D' && Math.abs(next.angle - cut.angle) <= PAIR_MAX_ANGLE_GAP) {
            components.push({ cut: next.number, kind: 'D', angle: next.angle });
            i++;
        }
        plans.push({ id: plans.length, nominalAngle: cut.angle, components, paired: components.length === 2 });
    }
    return plans;
}

/** Component that owns `moment` for this elevation. Paired reflectivity is owned by D (final) with S as the provisional source. */
export function ownersOf(plan: ElevationPlan, moment: string): ElevationComponent[] {
    const owners = plan.components.filter((c) => momentsOfKind(c.kind).includes(moment));
    if (moment === 'REF' && owners.length === 2) return owners; // S first (provisional), D last (final)
    return owners.slice(0, 1);
}

/** Union of the moments an elevation scan carries. */
export function elevationMoments(plan: ElevationPlan): string[] {
    const set = new Set<string>();
    for (const c of plan.components) for (const m of momentsOfKind(c.kind)) set.add(m);
    return [...set];
}

type MomentReadiness = 'none' | 'pending' | 'provisional' | 'final';

/** `doneCuts`: VCP cut numbers fully received so far. */
export function momentReadiness(plan: ElevationPlan, moment: string, doneCuts: ReadonlySet<number>): MomentReadiness {
    const owners = ownersOf(plan, moment);
    if (!owners.length) return 'none';
    const last = owners[owners.length - 1];
    if (doneCuts.has(last.cut)) return 'final';
    if (owners.length > 1 && doneCuts.has(owners[0].cut)) return 'provisional';
    return 'pending';
}

/** Pick the elevation whose nominal angle is nearest `target` among those carrying `moment`. */
export function pickElevation(plans: ElevationPlan[], moment: string, target: number): ElevationPlan | null {
    let best: ElevationPlan | null = null;
    let bestGap = Infinity;
    for (const plan of plans) {
        if (!ownersOf(plan, moment).length) continue;
        const gap = Math.abs(plan.nominalAngle - target);
        if (gap < bestGap - 1e-9) { best = plan; bestGap = gap; }
    }
    return best;
}
