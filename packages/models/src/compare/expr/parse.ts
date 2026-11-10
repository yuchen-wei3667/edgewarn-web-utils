export class ExprError extends Error {
    column: number;
    constructor(message: string, column = 1) {
        super(`Column ${column}: ${message}`);
        this.column = column;
    }
}
export type Expr = { op: string; args: Expr[]; value?: number; id?: string };
const functions: Readonly<Record<string, readonly [number, number]>> = {
    abs: [1, 1],
    sqrt: [1, 1],
    exp: [1, 1],
    ln: [1, 1],
    log10: [1, 1],
    min: [2, 4],
    max: [2, 4],
    clamp: [3, 3],
    where: [3, 3],
    wavg: [4, 8],
    valid: [1, 1],
    round: [1, 1],
    floor: [1, 1],
    ceil: [1, 1],
    sign: [1, 1],
    sin: [1, 1],
    cos: [1, 1],
    tan: [1, 1],
    atan2: [2, 2],
    deg: [1, 1],
    rad: [1, 1],
    pi: [0, 0],
    e: [0, 0],
};
const precedence: Record<string, number> = {
    '||': 1,
    '&&': 2,
    '<': 3,
    '<=': 3,
    '>': 3,
    '>=': 3,
    '==': 3,
    '!=': 3,
    '+': 4,
    '-': 4,
    '*': 5,
    '/': 5,
    '^': 7,
};
export function parseExpr(text: string): Expr {
    if (typeof text !== 'string' || text.length > 512)
        throw new ExprError('Expression exceeds 512 characters');
    const tokens: Array<{ s: string; col: number }> = [];
    const pattern = /\s+|(?:\d+(?:\.\d*)?|\.\d+)|[a-zA-Z_][a-zA-Z_0-9]*|<=|>=|==|!=|&&|\|\||[+*/^<>()!,\-]/gy;
    let at = 0;
    while (at < text.length) {
        pattern.lastIndex = at;
        const match = pattern.exec(text);
        if (!match) throw new ExprError('Unexpected character', at + 1);
        if (match[0].trim()) tokens.push({ s: match[0], col: at + 1 });
        at = pattern.lastIndex;
    }
    let pos = 0,
        nodes = 0;
    const peek = () => tokens[pos]?.s ?? '';
    const fail = (message: string): never => {
        throw new ExprError(message, tokens[pos]?.col ?? text.length + 1);
    };
    const node = (op: string, args: Expr[], value?: number, id?: string): Expr => {
        if (++nodes > 64) fail('Expression exceeds 64 nodes');
        return { op, args, value, id };
    };
    const read = (min: number, depth: number): Expr => {
        if (depth > 16) fail('Expression exceeds depth 16');
        const token = peek();
        pos++;
        let left: Expr;
        if (token === '-' || token === '!') left = node(`un${token}`, [read(6, depth + 1)]);
        else if (token === '(') {
            left = read(0, depth + 1);
            if (peek() !== ')') fail('Expected closing parenthesis');
            pos++;
        } else if (/^(?:\d|\.)/.test(token)) {
            const value = Number(token);
            if (!Number.isFinite(value)) fail('Decimal literal must be finite');
            left = node('num', [], value);
        } else if (/^[a-d]$/.test(token)) left = node('ref', [], undefined, token);
        else if (Object.hasOwn(functions, token)) {
            const args: Expr[] = [];
            if (peek() === '(') {
                pos++;
                if (peek() !== ')') {
                    do {
                        args.push(read(0, depth + 1));
                        if (peek() !== ',') break;
                        pos++;
                    } while (true);
                }
                if (peek() !== ')') fail('Expected closing parenthesis');
                pos++;
            }
            const [lo, hi] = functions[token];
            if (args.length < lo || args.length > hi || (token === 'wavg' && args.length % 2))
                fail(`Invalid arity for ${token}`);
            left = node(token, args);
        } else return fail('Expected an operand, decimal number or registered function');
        while (peek() in precedence && precedence[peek()] >= min) {
            const op = peek();
            pos++;
            left = node(op, [left, read(precedence[op] + (op === '^' ? 0 : 1), depth + 1)]);
        }
        return left;
    };
    const result = read(0, 1);
    if (pos !== tokens.length) fail('Unexpected token');
    const depth = (x: Expr): number => 1 + Math.max(0, ...x.args.map(depth));
    if (depth(result) > 16) fail('Expression exceeds depth 16');
    return result;
}
