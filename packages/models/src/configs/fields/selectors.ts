import type { ModelSelector, ModelSource, ValueTransform } from '../types.ts';

/** Kelvin to degrees Celsius, folded into decode so temperatures sit in float16's precise range. */
export const K_TO_C: ValueTransform = { offset: -273.15 };

const selector =
    (file: ModelSource) =>
    (variable: string, level: string, extra: Partial<ModelSelector> = {}): ModelSelector => ({
        file,
        variable,
        level,
        timing: 'instant',
        ...extra,
    });

/** A component of the near-surface / 2-D object. */
export const sfc = selector('sfc');
/** A component of the pressure-level object. */
export const prs = selector('prs');
/** A component of the simulated-satellite object. */
export const sat = selector('sat');
