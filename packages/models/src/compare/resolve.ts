import { getDataset } from '../datasets.ts';
import { chooseReference } from './gridRelation.ts';
import type { ComparisonJob, ComparisonSpec, OperandId, TimeSample } from './types.ts';
/** Catalog resolution precedes this boundary; only concrete published samples enter the worker. */
export function resolveComparison(
    spec: ComparisonSpec,
    per: Partial<Record<OperandId, TimeSample[]>>,
    alignment: ComparisonJob['alignment'],
): ComparisonJob {
    const reference = chooseReference(
        spec.reference,
        spec.operands.map((o) => ({ id: o.id, grid: getDataset(o.model).grid })),
    );
    return {
        v: 1,
        expr: spec.expr,
        reference: spec.operands.find((o) => o.id === reference)!.model,
        alignment,
        operands: spec.operands.map(({ run: _run, ...operand }) => {
            void _run;
            const samples = per[operand.id];
            if (!samples?.length) throw new Error(`No aligned samples for ${operand.id}`);
            return { ...operand, samples };
        }),
    };
}
