import type { ComparisonSpec, OperandSpec } from './types.ts';
const spec = (operands: OperandSpec[], expr: string): ComparisonSpec => ({
    v: 1,
    operands,
    expr,
    reference: 'coarsest',
    time: 'exact',
});
export const diffSpec = (operands: OperandSpec[]) => spec(operands, 'a - b');
export const absDiffSpec = (operands: OperandSpec[]) => spec(operands, 'abs(a - b)');
export const percentDiffSpec = (operands: OperandSpec[]) => spec(operands, '100 * (a - b) / b');
export const zscoreSpec = (operands: OperandSpec[]) => spec(operands, '(a - b) / c');
export function blendSpec(operands: OperandSpec[], weights: number[], renormalize = true): ComparisonSpec {
    if (
        weights.length !== operands.length ||
        weights.some((w) => !Number.isFinite(w) || w < 0) ||
        !weights.some((w) => w > 0)
    )
        throw new Error('Blend needs finite nonnegative weights with a positive total');
    const max = Math.max(...weights);
    const scaled = weights.map((w) => w / max);
    const sum = scaled.reduce((a, b) => a + b, 0);
    const parts = operands.map((o, i) => [o.id, (scaled[i] / sum).toFixed(8)]);
    return {
        ...spec(
            operands,
            renormalize
                ? `wavg(${parts.flat().join(',')})`
                : parts.map(([id, weight]) => `${id} * ${weight}`).join(' + '),
        ),
        reference: 'finest',
    };
}
export function runDeltaSpec(a: OperandSpec, hours: number) {
    if (!Number.isFinite(hours) || hours <= 0) throw new Error('Run offset must be positive');
    return diffSpec([
        { ...a, id: 'a' },
        { ...a, id: 'b', run: { kind: 'offset', from: 'a', hours } },
    ]);
}
