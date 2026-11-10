import type { Expr } from './parse.ts';
function apply(op: string, a: number[]): number {
    if (op === 'valid') return Number.isFinite(a[0]) ? 1 : 0;
    if (op === 'where') return Number.isFinite(a[0]) ? a[a[0] ? 1 : 2] : NaN;
    if (op === 'wavg') {
        let sum = 0,
            weights = 0;
        for (let i = 0; i < a.length; i += 2)
            if (Number.isFinite(a[i]) && Number.isFinite(a[i + 1]) && a[i + 1] >= 0) {
                sum += a[i] * a[i + 1];
                weights += a[i + 1];
            }
        return weights ? sum / weights : NaN;
    }
    if (a.some((x) => !Number.isFinite(x))) return NaN;
    const [x, y] = a;
    switch (op) {
        case '+':
            return x + y;
        case '-':
            return x - y;
        case '*':
            return x * y;
        case '/':
            return y ? x / y : NaN;
        case '^':
            return x ** y;
        case 'un-':
            return -x;
        case 'un!':
            return +!x;
        case '<':
            return +(x < y);
        case '<=':
            return +(x <= y);
        case '>':
            return +(x > y);
        case '>=':
            return +(x >= y);
        case '==':
            return +(x === y);
        case '!=':
            return +(x !== y);
        case '&&':
            return +(!!x && !!y);
        case '||':
            return +(!!x || !!y);
        case 'abs':
            return Math.abs(x);
        case 'sqrt':
            return Math.sqrt(x);
        case 'exp':
            return Math.exp(x);
        case 'ln':
            return Math.log(x);
        case 'log10':
            return Math.log10(x);
        case 'min':
            return Math.min(...a);
        case 'max':
            return Math.max(...a);
        case 'clamp':
            return Math.min(Math.max(x, y), a[2]);
        case 'round':
            return Math.round(x);
        case 'floor':
            return Math.floor(x);
        case 'ceil':
            return Math.ceil(x);
        case 'sign':
            return Math.sign(x);
        case 'sin':
            return Math.sin(x);
        case 'cos':
            return Math.cos(x);
        case 'tan':
            return Math.tan(x);
        case 'atan2':
            return Math.atan2(x, y);
        case 'deg':
            return (x * 180) / Math.PI;
        case 'rad':
            return (x * Math.PI) / 180;
        case 'pi':
            return Math.PI;
        case 'e':
            return Math.E;
        default:
            throw new Error('Unknown instruction');
    }
}
/** Postorder register program; scratch space is bounded independently of grid size. */
export function evaluate(ast: Expr, inputs: Record<string, Float32Array>, size: number, check = () => {}) {
    const code: Array<{ expr: Expr; args: number[] }> = [];
    const compile = (expr: Expr): number => {
        const args = expr.args.map(compile);
        code.push({ expr, args });
        return code.length - 1;
    };
    compile(ast);
    const data = new Float32Array(size),
        scratch = code.map(() => new Float32Array(4096));
    let overflow = 0;
    for (let at = 0; at < size; at += 4096) {
        check();
        const count = Math.min(4096, size - at);
        code.forEach(({ expr, args }, r) => {
            const values = new Array<number>(args.length);
            for (let i = 0; i < count; i++) {
                for (let j = 0; j < args.length; j++) values[j] = scratch[args[j]][i];
                scratch[r][i] =
                    expr.op === 'num'
                        ? expr.value!
                        : expr.op === 'ref'
                          ? inputs[expr.id!][at + i]
                          : apply(expr.op, values);
            }
        });
        for (let i = 0; i < count; i++) {
            const value = scratch[code.length - 1][i];
            if (!Number.isFinite(value) || Math.abs(value) > 65504) {
                data[at + i] = NaN;
                overflow++;
            } else data[at + i] = value;
        }
    }
    return { data, overflow };
}

/** Yield between bounded batches so worker cancel messages can be received during evaluation. */
export async function evaluateAsync(
    ast: Expr,
    inputs: Record<string, Float32Array>,
    size: number,
    check: () => void,
) {
    const data = new Float32Array(size);
    let overflow = 0;
    for (let at = 0; at < size; at += 65536) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        check();
        const count = Math.min(65536, size - at);
        const part = evaluate(
            ast,
            Object.fromEntries(
                Object.entries(inputs).map(([id, values]) => [id, values.subarray(at, at + count)]),
            ),
            count,
            check,
        );
        data.set(part.data, at);
        overflow += part.overflow;
    }
    return { data, overflow };
}
