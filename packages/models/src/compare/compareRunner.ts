import { operandUnits } from './operandUnits.ts';
import { ModelHttpError, ModelMissing } from '../sources/errors.ts';
import { COMPARE_JOB_MAX_BYTES } from '../limits.ts';
import { inputsFor, getModelField } from '../catalog.ts';
import { getDataset } from '../datasets.ts';
import type { ModelFieldFrame, ModelFieldRead } from '../field.ts';
import { fromHalf, toHalf } from '@edgewarn/web-utils/grib2';
import { projectionFor } from '../projection/index.ts';
import { checkExpr } from './expr/check.ts';
import { evaluateAsync } from './expr/vm.ts';
import { refuseMovingGrid } from './gridRelation.ts';
import { regridLevel } from './regrid.ts';
import type { ComparisonDecodeRequest, ComparisonFrameInfo } from './types.ts';
/** What one decoded operand sample hands back to the comparison. */
export interface Produced {
    combined: { data: Uint16Array; channels: 1 | 2 };
    grid: ReturnType<typeof getDataset>['grid'];
    proj: ReturnType<typeof projectionFor>;
    reads: ModelFieldRead[];
    fetched: number;
    ensemble?: ModelFieldFrame['ensemble'];
    normalization?: ModelFieldFrame['normalization'];
    def: NonNullable<ReturnType<typeof getModelField>>;
    selectors: ReturnType<typeof inputsFor>;
    dataset: ReturnType<typeof getDataset>;
    compare?: ComparisonFrameInfo;
}
/** Sequential operands bound decoded source memory; no source fields survive their sample. */
export async function runComparison<R extends ComparisonDecodeRequest>(
    req: R,
    produce: (req: R) => Promise<Produced>,
    check: () => void,
    maxBytes = COMPARE_JOB_MAX_BYTES,
): Promise<Produced> {
    const job = req.compare!;
    if (
        job.v !== 1 ||
        job.reference !== req.model ||
        !['native', 'held', 'interpolated'].includes(job.alignment)
    )
        throw new Error('Invalid comparison contract');
    if (!Array.isArray(job.operands) || job.operands.length < 2 || job.operands.length > 4)
        throw new Error('Comparison needs two to four operands');
    const defs = job.operands.map((o) => {
        const def = getModelField(o.fieldId);
        if (!def || def.kind === 'categorical') throw new Error(`Invalid comparison field ${o.fieldId}`);
        return def;
    });
    const checked = checkExpr(
        job.expr,
        job.operands.map((o, i) => ({ id: o.id, ...operandUnits(defs[i], o.product) })),
    );
    for (const o of job.operands) refuseMovingGrid(o.model, `Operand ${o.id.toUpperCase()}`);
    const dataset = getDataset(job.reference),
        factor = dataset.factors[req.level];
    if (!factor) throw new Error('Invalid reference level');
    const size = Math.ceil(dataset.grid.nx / factor) * Math.ceil(dataset.grid.ny / factor);
    // Four float32 operands, one temporal accumulator, VM result, half output and bounded scratch.
    if (size * (job.operands.length * 4 + 16) + 4096 * 64 * 4 > maxBytes)
        throw new Error('Comparison exceeds memory budget');
    const inputs: Record<string, Float32Array> = {},
        reads: ModelFieldRead[] = [];
    const operands: ComparisonFrameInfo['operands'] = [],
        incomplete: string[] = [];
    let fetched = 0,
        first: Produced | undefined;
    const validMs = req.initMs + req.minutes * 60000;
    let actualAlignment: typeof job.alignment = 'native';
    for (let index = 0; index < job.operands.length; index++) {
        const operand = job.operands[index];
        if (
            !Array.isArray(operand.samples) ||
            operand.samples.length < 1 ||
            operand.samples.length > 2 ||
            operand.samples.some(
                (s) =>
                    !Number.isFinite(s.initMs) ||
                    !Number.isFinite(s.minutes) ||
                    s.minutes < 0 ||
                    !Number.isFinite(s.weight) ||
                    s.weight <= 0,
            ) ||
            Math.abs(operand.samples.reduce((n, s) => n + s.weight, 0) - 1) > 1e-6
        )
            throw new Error(`Invalid samples for ${operand.id}`);
        if (
            operand.samples.length > 1 &&
            (defs[index].kind !== 'scalar' ||
                inputsFor(defs[index], operand.model).some((s) => s.timing !== 'instant'))
        )
            throw new Error('Only instant scalar fields can interpolate');
        const times = operand.samples.map((s) => s.initMs + s.minutes * 60000);
        if (operand.samples.length === 2) {
            const [a, b] = operand.samples;
            if (
                a.initMs !== b.initMs ||
                !(times[0] < validMs && validMs < times[1]) ||
                Math.abs(b.weight - (validMs - times[0]) / (times[1] - times[0])) > 1e-6
            )
                throw new Error(`Invalid interpolation for ${operand.id}`);
            actualAlignment = 'interpolated';
        } else if (times[0] !== validMs) {
            if (times[0] > validMs) throw new Error(`Future sample for ${operand.id}`);
            if (actualAlignment !== 'interpolated') actualAlignment = 'held';
        }
        const values = new Float32Array(size);
        let report: ComparisonFrameInfo['operands'][number]['regrid'] | undefined;
        let ensemble: ModelFieldFrame['ensemble'];
        for (const sample of operand.samples) {
            check();
            const source = getDataset(operand.model);
            const targetMetres = projectionFor(dataset.grid).cellMetres(40) * factor;
            const sourceMetres = projectionFor(source.grid).cellMetres(40);
            let level = 0;
            source.factors.forEach((f, i) => {
                if (sourceMetres * f <= targetMetres) level = i;
            });
            const sourceCells =
                Math.ceil(source.grid.nx / source.factors[level]) *
                Math.ceil(source.grid.ny / source.factors[level]);
            if (
                size * (job.operands.length * 4 + 12) +
                    sourceCells * (source.ensemble ? 4 * (source.ensemble.batch ?? 6) + 24 : 12) +
                    4096 * 64 * 4 >
                maxBytes
            )
                throw new Error('Comparison exceeds memory budget; reduce operands or zoom out');
            let got: Produced;
            try {
                got = await produce({
                    ...req,
                    ...operand,
                    ...sample,
                    type: 'decode',
                    compare: undefined,
                    level,
                } as R);
            } catch (error) {
                if (
                    error instanceof ModelMissing ||
                    (error instanceof ModelHttpError && [403, 404].includes(error.status))
                )
                    throw new ModelMissing(`${operand.id}: ${error.message}`);
                throw error;
            }
            check();
            if (!first) first = { ...got, combined: { data: new Uint16Array(0), channels: 1 } };
            const transform = operandUnits(got.def, operand.product);
            const physical = new Float32Array(got.combined.data.length / got.combined.channels);
            for (let i = 0; i < physical.length; i++) {
                const a = fromHalf(got.combined.data[i * got.combined.channels]);
                const value =
                    got.combined.channels === 2 ? Math.hypot(a, fromHalf(got.combined.data[i * 2 + 1])) : a;
                physical[i] = value * transform.scale + transform.offset;
            }
            const aligned = regridLevel(
                physical,
                got.grid,
                source.factors[level],
                dataset.grid,
                factor,
                check,
            );
            for (let i = 0; i < size; i++) values[i] += aligned.data[i] * sample.weight;
            report = aligned.report;
            reads.push(...got.reads);
            fetched += got.fetched;
            ensemble = got.ensemble;
            if (ensemble && ensemble.membersUsed < ensemble.membersExpected)
                incomplete.push(
                    `Incomplete: operand ${operand.id} computed from ${ensemble.membersUsed} of ${ensemble.membersExpected} members`,
                );
        }
        let covered = 0;
        for (const value of values) if (Number.isFinite(value)) covered++;
        report!.coverage = covered / size;
        inputs[operand.id] = values;
        operands.push({ ...operand, regrid: report!, ensemble });
    }
    if (actualAlignment !== job.alignment) throw new Error('Comparison alignment does not match its samples');
    // The comparison is drawn only where every operand has data, so no result mixes a field with a gap in another model's domain.
    const arrays = Object.values(inputs);
    let overlap = 0;
    for (let i = 0; i < size; i++) {
        if (arrays.every((values) => Number.isFinite(values[i]))) overlap++;
        else for (const values of arrays) values[i] = NaN;
    }
    if (!overlap) throw new Error('These models do not overlap, so there is nothing to compare.');
    const result = await evaluateAsync(checked.ast, inputs, size, check);
    const data = Uint16Array.from(result.data, toHalf);
    return {
        ...first!,
        dataset,
        grid: dataset.grid,
        proj: projectionFor(dataset.grid),
        combined: { data, channels: 1 },
        reads,
        fetched,
        ensemble: undefined,
        normalization: undefined,
        def: { ...defs[0], units: checked.units, display: undefined },
        compare: {
            expr: job.expr,
            units: checked.units,
            valueKind: checked.valueKind,
            reference: job.reference,
            referenceLevel: req.level,
            alignment: job.alignment,
            operands,
            incomplete,
            overflow: result.overflow,
        },
    };
}
