import type { OperandId, TimePolicy, TimeSample } from './types.ts';
interface Step {
    minutes: number;
    validMs: number;
    published: boolean;
}
export function alignSteps(
    operands: Array<{ id: OperandId; steps: Step[]; interpolable: boolean }>,
    policy: TimePolicy,
) {
    if (!operands.length) return [];
    const lists = operands.map((o) =>
        o.steps.filter((s) => s.published).sort((a, b) => a.validMs - b.validMs),
    );
    const times = [...new Set(lists.flatMap((l) => l.map((s) => s.validMs)))].sort((a, b) => a - b);
    return times.flatMap((validMs) => {
        const per: Partial<Record<OperandId, TimeSample[]>> = {};
        let alignment: 'native' | 'held' | 'interpolated' = 'native';
        for (let i = 0; i < operands.length; i++) {
            const list = lists[i],
                native = list.find((s) => s.validMs === validMs);
            const sample = (s: Step, weight: number): TimeSample => ({
                initMs: s.validMs - s.minutes * 60000,
                minutes: s.minutes,
                weight,
            });
            if (native) {
                per[operands[i].id] = [sample(native, 1)];
                continue;
            }
            const before = list.filter((s) => s.validMs < validMs).at(-1),
                after = list.find((s) => s.validMs > validMs);
            if (policy === 'exact' || !before) return [];
            if (policy === 'hold') {
                per[operands[i].id] = [sample(before, 1)];
                alignment = 'held';
            } else if (operands[i].interpolable && after) {
                const w = (validMs - before.validMs) / (after.validMs - before.validMs);
                per[operands[i].id] = [sample(before, 1 - w), sample(after, w)];
                alignment = 'interpolated';
            } else return [];
        }
        return [{ validMs, minutes: 0, published: true, alignment, per }];
    });
}
