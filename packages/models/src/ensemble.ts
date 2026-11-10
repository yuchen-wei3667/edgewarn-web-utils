import type { EnsembleConfig, EnsembleProduct } from './configs/types.ts';
import { fromHalf, HALF_NAN, toHalf } from '@edgewarn/web-utils/grib2';

/** Member numbers an ensemble holds: the control (0) when it exists, then 1..perturbed. */
export const memberIds = (ens: Pick<EnsembleConfig, 'perturbed' | 'control'>): number[] =>
    Array.from({ length: ens.perturbed + (ens.control ? 1 : 0) }, (_, i) => i + (ens.control ? 0 : 1));

/** What the worker derives from members; `member` is not here because it is one member's own field. */
export type ComputedStat = 'mean' | 'sd' | 'min' | 'max' | 'exceed';

export interface ExceedThreshold {
    op: '>' | '<';
    value: number;
}

/**
 * Running reduction over ensemble members. One float16 level grid goes in per member and nothing but the
 * accumulators is kept, so memory is O(grid) however many members there are. A missing (NaN) member value is
 * skipped per cell; a cell that no member covers stays missing.
 */
export class EnsembleReducer {
    private readonly size: number;
    private readonly count: Uint16Array;
    private readonly mean: Float32Array | null;
    private readonly m2: Float32Array | null;
    private readonly lo: Float32Array | null;
    private readonly hi: Float32Array | null;
    private readonly hits: Uint16Array | null;
    private members = 0;

    private readonly stat: ComputedStat;
    private readonly threshold?: ExceedThreshold;

    constructor(size: number, stat: ComputedStat, threshold?: ExceedThreshold) {
        if (stat === 'exceed' && !threshold) throw new Error('An exceedance reduction needs a threshold');
        this.size = size;
        this.stat = stat;
        this.threshold = threshold;
        this.count = new Uint16Array(size);
        const welford = stat === 'mean' || stat === 'sd';
        this.mean = welford ? new Float32Array(size) : null;
        this.m2 = stat === 'sd' ? new Float32Array(size) : null;
        this.lo = stat === 'min' ? new Float32Array(size).fill(Infinity) : null;
        this.hi = stat === 'max' ? new Float32Array(size).fill(-Infinity) : null;
        this.hits = stat === 'exceed' ? new Uint16Array(size) : null;
    }

    /** Members folded in so far, missing ones included. */
    get added(): number {
        return this.members;
    }

    add(grid: Uint16Array): void {
        if (grid.length !== this.size)
            throw new Error(`Ensemble member has ${grid.length} cells, expected ${this.size}`);
        this.members++;
        const { count, mean, m2, lo, hi, hits, threshold } = this;
        for (let i = 0; i < this.size; i++) {
            const v = fromHalf(grid[i]);
            if (Number.isNaN(v)) continue;
            const n = ++count[i];
            if (mean) {
                const delta = v - mean[i];
                mean[i] += delta / n;
                if (m2) m2[i] += delta * (v - mean[i]);
            }
            if (lo && v < lo[i]) lo[i] = v;
            if (hi && v > hi[i]) hi[i] = v;
            if (hits && (threshold!.op === '>' ? v > threshold!.value : v < threshold!.value)) hits[i]++;
        }
    }

    /** float16 result; sd needs two valid members, so a cell with one is missing. */
    result(): Uint16Array {
        const out = new Uint16Array(this.size);
        for (let i = 0; i < this.size; i++) {
            const n = this.count[i];
            let v = NaN;
            if (n > 0) {
                switch (this.stat) {
                    case 'mean':
                        v = this.mean![i];
                        break;
                    case 'sd':
                        v = n > 1 ? Math.sqrt(this.m2![i] / (n - 1)) : NaN;
                        break;
                    case 'min':
                        v = this.lo![i];
                        break;
                    case 'max':
                        v = this.hi![i];
                        break;
                    case 'exceed':
                        v = (100 * this.hits![i]) / n;
                        break;
                }
            }
            out[i] = Number.isNaN(v) ? HALF_NAN : toHalf(v);
        }
        return out;
    }
}

/** What the product select calls each product. */
export const PRODUCT_LABELS: Readonly<Record<EnsembleProduct, string>> = {
    mean: 'Mean',
    sprd: 'Spread',
    nsprd: 'Normalized spread (30-run climatology)',
    prob: 'Probability',
    member: 'Single member',
    min: 'Minimum',
    max: 'Maximum',
    exceed: 'Chance of exceeding',
    p10: '10th percentile',
    p50: '50th percentile',
    p90: '90th percentile',
};

/** Roughly what one member's field costs to read, in megabytes (measured on live GEFS and IFS ENS 2 m temperature). */
export const MEMBER_READ_MB = 0.3;

interface OfferedSource {
    ensembles: readonly EnsembleProduct[];
    capabilities: { ensemble: null | { computed: readonly ComputedStat[] } };
}

/** The products a model offers: the ones it configures, then the statistics the worker can derive from its members. */
export function offeredProducts(dataset: OfferedSource): EnsembleProduct[] {
    // Normalized spread is a mode of the spread product, chosen by its raw/normalized control.
    const out = dataset.ensembles.filter((product) => product !== 'nsprd');
    for (const stat of dataset.capabilities.ensemble?.computed ?? []) {
        if ((stat === 'min' || stat === 'max' || stat === 'exceed') && !out.includes(stat)) out.push(stat);
    }
    return out;
}

/** Whether the worker has to read several members to draw this product. */
export function isComputedProduct(dataset: { ensemble?: EnsembleConfig }, product: EnsembleProduct): boolean {
    const ens = dataset.ensemble;
    if (!ens) return false;
    if (product === 'nsprd') return true;
    if (product === 'min' || product === 'max' || product === 'exceed') return true;
    return ens.stats === 'computed' && (product === 'mean' || product === 'sprd');
}

/** Members one frame of this product reads. */
export const membersRead = (dataset: { ensemble?: EnsembleConfig }, product: EnsembleProduct): number =>
    dataset.ensemble && isComputedProduct(dataset, product) ? memberIds(dataset.ensemble).length : 1;

/** "Control" for member 0, "Member 07" otherwise. */
export const memberLabel = (member: number): string =>
    member === 0 ? 'Control' : `Member ${String(member).padStart(2, '0')}`;

/** The member `by` places from `from`, wrapping at both ends. */
export function stepMemberId(
    ens: Pick<EnsembleConfig, 'perturbed' | 'control'>,
    from: number,
    by: 1 | -1,
): number {
    const ids = memberIds(ens);
    const at = ids.indexOf(from);
    return ids[((at < 0 ? 0 : at) + by + ids.length) % ids.length];
}

/** The member to show when a person first picks the member product. */
export const firstMember = (ens: Pick<EnsembleConfig, 'perturbed' | 'control'>): number => memberIds(ens)[0];

/** `>35.5` style threshold text for URLs and frame ids (stored units). */
export const thresholdKey = (t: ExceedThreshold): string => `${t.op === '>' ? 'gt' : 'lt'}${t.value}`;

export function parseThreshold(text: string): ExceedThreshold | null {
    const m = /^(gt|lt)(-?\d+(?:\.\d+)?)$/.exec(text);
    return m ? { op: m[1] === 'gt' ? '>' : '<', value: Number(m[2]) } : null;
}
