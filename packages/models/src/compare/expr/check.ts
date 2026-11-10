import { ExprError, parseExpr, type Expr } from './parse.ts';
import type { ValueKind } from '../types.ts';
interface OperandUnits {
    id: string;
    units: string;
    ratioScale?: boolean;
    valueKind?: ValueKind;
}
export function checkExpr(text: string, operands: OperandUnits[]) {
    if (
        operands.length < 2 ||
        operands.length > 4 ||
        new Set(operands.map((x) => x.id)).size !== operands.length ||
        operands.some((x) => !/^[a-d]$/.test(x.id))
    )
        throw new ExprError('Expected two to four unique operands a..d');
    const ast = parseExpr(text),
        refs = new Set<string>();
    const visit = (x: Expr): { units: string; bool: boolean; kind?: ValueKind } => {
        if (x.op === 'num' || x.op === 'pi' || x.op === 'e') return { units: '', bool: false };
        if (x.op === 'ref') {
            const def = operands.find((o) => o.id === x.id);
            if (!def) throw new ExprError(`Unknown operand ${x.id}`);
            refs.add(x.id!);
            return { units: def.units, bool: false, kind: def.valueKind ?? 'absolute' };
        }
        const args = x.args.map(visit);
        const same = (indices: number[]) => {
            if (indices.some((i) => args[i].units !== args[indices[0]].units))
                throw new ExprError(`Incompatible units for ${x.op}`);
        };
        if (['+', '-', '<', '<=', '>', '>=', '==', '!=', 'min', 'max', 'clamp'].includes(x.op))
            same(args.map((_, i) => i));
        if (x.op === 'where') {
            if (!args[0].bool) throw new ExprError('where requires a boolean condition');
            same([1, 2]);
        }
        if (['&&', '||', 'un!'].includes(x.op) && args.some((a) => !a.bool))
            throw new ExprError('Logical operators require booleans');
        if (x.op === 'wavg') {
            same(args.map((_, i) => i).filter((i) => i % 2 === 0));
            if (args.some((a, i) => i % 2 && a.units)) throw new ExprError('Weights must be unitless');
        }
        if (
            x.op !== 'where' &&
            x.op !== 'valid' &&
            !['&&', '||', 'un!'].includes(x.op) &&
            args.some((a) => a.bool)
        )
            throw new ExprError('Arithmetic requires numeric values');
        if (['exp', 'ln', 'log10', 'sin', 'cos', 'tan', 'deg', 'rad'].includes(x.op) && args[0].units)
            throw new ExprError(`${x.op} requires a unitless argument`);
        if (x.op === 'atan2') same([0, 1]);
        const bool = ['valid', '<', '<=', '>', '>=', '==', '!=', '&&', '||', 'un!'].includes(x.op);
        const units =
            bool || x.op === 'sign' || x.op === 'atan2'
                ? ''
                : x.op === 'sqrt' || x.op === '^'
                  ? args.some((a) => a.units)
                      ? 'custom'
                      : ''
                  : x.op === 'where'
                    ? args[1].units
                    : ['*', '/', '^'].includes(x.op)
                      ? x.op === '/' && args[0].units === args[1].units
                          ? ''
                          : !args[0].units
                            ? args[1].units
                            : !args[1].units
                              ? args[0].units
                              : 'custom'
                      : args[0].units;
        const kind: ValueKind =
            x.op === '-' && args[0].units === args[1].units
                ? 'delta'
                : x.op === '/' && args[0].units === args[1].units
                  ? 'ratio'
                  : ['*', '/'].includes(x.op) && !args[1].units
                    ? (args[0].kind ?? 'absolute')
                    : x.op === '*' && !args[0].units
                      ? (args[1].kind ?? 'absolute')
                      : x.op === 'where'
                        ? (args[1].kind ?? 'absolute')
                        : (args[0].kind ?? 'absolute');
        return { units, bool, kind };
    };
    const result = visit(ast);
    let valueKind: ValueKind = result.kind ?? 'absolute';
    const numerator = ast.op === '/' ? ast.args[0] : undefined;
    const percentDelta =
        numerator?.op === '*' &&
        numerator.args.some((x) => x.op === 'num' && x.value === 100) &&
        numerator.args.some((x) => x.op === '-');
    if (percentDelta) {
        if (operands.some((o) => refs.has(o.id) && !o.ratioScale))
            throw new ExprError('Percent difference requires ratio-scale fields');
        valueKind = 'percent';
        result.units = '%';
    } else if (result.units === 'custom') valueKind = 'custom';
    return { ast, refs: [...refs], units: result.units, valueKind };
}
