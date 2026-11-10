import type { EnsembleProduct, ModelId } from '../datasets.ts';
import type { ExceedThreshold } from '../ensemble.ts';
export type OperandId = 'a' | 'b' | 'c' | 'd';
export type ValueKind = 'absolute' | 'delta' | 'ratio' | 'percent' | 'custom';
export type TimePolicy = 'exact' | 'hold' | 'interpolate';
export type RunRef =
    { kind: 'latest' } | { kind: 'pin'; initMs: number } | { kind: 'offset'; from: OperandId; hours: number };
export interface OperandSpec {
    id: OperandId;
    model: ModelId;
    product: EnsembleProduct;
    fieldId: string;
    member?: number;
    threshold?: ExceedThreshold;
    run: RunRef;
}
export interface ComparisonSpec {
    v: 1;
    operands: OperandSpec[];
    expr: string;
    reference: 'finest' | 'coarsest' | OperandId;
    time: TimePolicy;
    label?: string;
}
export interface TimeSample {
    initMs: number;
    minutes: number;
    weight: number;
}
export interface ResolvedOperand extends Omit<OperandSpec, 'run'> {
    samples: TimeSample[];
}
export interface ComparisonJob {
    v: 1;
    expr: string;
    operands: ResolvedOperand[];
    reference: ModelId;
    alignment: 'native' | 'held' | 'interpolated';
}
export interface RegridReport {
    relation: 'identical' | 'shift' | 'resample';
    method: 'none' | 'column-shift' | 'bilinear' | 'area-mean';
    coverage: number;
    subsample: number;
}
export interface ComparisonFrameInfo {
    expr: string;
    units: string;
    valueKind: ValueKind;
    reference: ModelId;
    referenceLevel: number;
    alignment: ComparisonJob['alignment'];
    operands: Array<
        ResolvedOperand & {
            regrid: RegridReport;
            ensemble?: import('../field.ts').ModelFieldFrame['ensemble'];
        }
    >;
    incomplete: string[];
    overflow: number;
}

/**
 * What `runComparison` reads and rewrites of a decode request. A host's own request (job id, tiles, ...) extends it, and
 * each operand sample is decoded with a copy of that request whose model, field and run are the operand's.
 */
export interface ComparisonDecodeRequest {
    type: 'decode';
    compare?: ComparisonJob;
    model: ModelId;
    product: EnsembleProduct;
    fieldId: string;
    initMs: number;
    minutes: number;
    level: number;
    member?: number;
    threshold?: ExceedThreshold;
}
