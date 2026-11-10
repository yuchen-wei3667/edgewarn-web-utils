import { countPublishedSteps } from '../listing.ts';
import { getDataset, type ModelDataset } from '../datasets.ts';
export function runPair(dataset: ModelDataset, initMs: number, offsetHours: number): [number, number] {
    const older = initMs - offsetHours * 3600000;
    if (
        !Number.isFinite(initMs) ||
        !Number.isFinite(offsetHours) ||
        offsetHours <= 0 ||
        [initMs, older].some(
            (t) => t % 3600000 !== 0 || !dataset.cycleHours.includes(new Date(t).getUTCHours()),
        )
    )
        throw new Error(`Run offset must land on ${dataset.label} cycles: ${dataset.cycleHours.join(', ')}`);
    return [initMs, older];
}

/** Read-only availability probe for an arbitrary older cycle, independent of picker history. */
export async function probeOlderRun(
    dataset: ModelDataset,
    initMs: number,
    hours: number,
    probe: Parameters<typeof countPublishedSteps>[2],
    signal?: AbortSignal,
) {
    const [, older] = runPair(dataset, initMs, hours);
    return { initMs: older, published: await countPublishedSteps(dataset, older, probe, signal) };
}

/** Resolve pinned/latest/relative runs with cycle and dependency validation. */
export function resolveRuns(
    operands: import('./types.ts').OperandSpec[],
    latest: Partial<Record<import('../datasets.ts').ModelId, number>>,
) {
    const resolved: Partial<Record<import('./types.ts').OperandId, number>> = {};
    const visiting = new Set<string>();
    const read = (id: import('./types.ts').OperandId): number => {
        if (resolved[id] !== undefined) return resolved[id];
        if (visiting.has(id)) throw new Error('Cyclic run offsets');
        const operand = operands.find((o) => o.id === id);
        if (!operand) throw new Error(`Unknown run operand ${id}`);
        visiting.add(id);
        const dataset = getDataset(operand.model),
            run = operand.run;
        const init =
            run.kind === 'pin'
                ? run.initMs
                : run.kind === 'latest'
                  ? latest[operand.model]
                  : read(run.from) - run.hours * 3600000;
        if (run.kind === 'offset' && (!Number.isFinite(run.hours) || run.hours <= 0))
            throw new Error('Run offset must be positive');
        if (
            init === undefined ||
            !Number.isFinite(init) ||
            init % 3600000 !== 0 ||
            !dataset.cycleHours.includes(new Date(init).getUTCHours())
        )
            throw new Error(
                `${operand.id}: run must land on ${dataset.label} cycles ${dataset.cycleHours.join(', ')}`,
            );
        visiting.delete(id);
        resolved[id] = init;
        return init;
    };
    for (const operand of operands) read(operand.id);
    return resolved;
}
