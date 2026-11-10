import { absDiffSpec, blendSpec, diffSpec, percentDiffSpec, zscoreSpec } from './presets.ts';
import type { ComparisonSpec } from './types.ts';

type SpecKind = 'diff' | 'absdiff' | 'percent' | 'zscore' | 'run' | 'blend' | 'formula';

interface SpecDescription {
    kind: SpecKind;
    /** Short chip text: "A - B", "Blend", "Formula". */
    chip: string;
    /** Blend weights as shares summing to 1, in operand order. */
    weights?: number[];
    /** Blend only: a missing operand is skipped and the rest renormalised. */
    renormalize?: boolean;
    /** Run-to-run only: hours the second operand's run is older than the first's. */
    offsetHours?: number;
}

const CHIPS: Record<Exclude<SpecKind, 'run' | 'blend' | 'formula'>, string> = {
    diff: 'A - B',
    absdiff: '|A - B|',
    percent: '% A vs B',
    zscore: '(A - B) / C',
};
function weightsOf(spec: ComparisonSpec): Pick<SpecDescription, 'weights' | 'renormalize'> | null {
    const ids = spec.operands.map((o) => o.id);
    const wavg = /^wavg\((.+)\)$/.exec(spec.expr);
    if (wavg) {
        const parts = wavg[1].split(',');
        if (parts.length !== ids.length * 2) return null;
        const weights = ids.map((id, i) => (parts[i * 2] === id ? Number(parts[i * 2 + 1]) : NaN));
        return weights.every((w) => Number.isFinite(w) && w >= 0) ? { weights, renormalize: true } : null;
    }
    const sum = spec.expr.split(' + ');
    if (sum.length !== ids.length || sum.length < 2) return null;
    const weights = sum.map((term, i) => {
        const m = /^([a-d]) \* ([0-9.]+)$/.exec(term);
        return m && m[1] === ids[i] ? Number(m[2]) : NaN;
    });
    return weights.every((w) => Number.isFinite(w)) ? { weights, renormalize: false } : null;
}

/** Recovers the preset behind a spec from its expression, so a link only has to carry the expression. */
export function describeSpec(spec: ComparisonSpec): SpecDescription {
    const b = spec.operands[1];
    const same = (build: (ops: ComparisonSpec['operands']) => ComparisonSpec) =>
        build(spec.operands).expr === spec.expr;
    if (spec.operands.length === 2 && same(diffSpec)) {
        return b.run.kind === 'offset' && b.run.from === 'a'
            ? { kind: 'run', chip: `Run change (${b.run.hours} h)`, offsetHours: b.run.hours }
            : { kind: 'diff', chip: CHIPS.diff };
    }
    if (spec.operands.length === 2 && same(absDiffSpec)) return { kind: 'absdiff', chip: CHIPS.absdiff };
    if (spec.operands.length === 2 && same(percentDiffSpec)) return { kind: 'percent', chip: CHIPS.percent };
    if (spec.operands.length === 3 && same(zscoreSpec)) return { kind: 'zscore', chip: CHIPS.zscore };
    const blend = weightsOf(spec);
    if (blend?.weights) {
        const total = blend.weights.reduce((x, y) => x + y, 0);
        return {
            kind: 'blend',
            chip: 'Blend',
            weights: blend.weights.map((w) => w / total),
            renormalize: blend.renormalize,
        };
    }
    return { kind: 'formula', chip: 'Formula' };
}

/** A blend from whole-percent weights: the same text `describeSpec` reads back. */
export function blendFromPercent(
    operands: ComparisonSpec['operands'],
    percent: number[],
    renormalize: boolean,
): ComparisonSpec {
    const total = percent.reduce((x, y) => x + y, 0);
    return blendSpec(operands, total > 0 ? percent : percent.map(() => 1), renormalize);
}
