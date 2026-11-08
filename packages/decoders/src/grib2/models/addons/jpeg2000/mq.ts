import { Memory } from '../../../../internal/memory.ts';
/**
 * The MQ arithmetic decoder of JPEG 2000 (ITU-T T.800 annex C), the same coder JBIG2 uses. One decoder reads
 * one code block's bytes; `states` holds the adaptive state of its 19 contexts.
 */

/** Probability estimate Qe, next state after a more probable symbol, next state after a less probable one, and whether that swaps the sense of the more probable symbol. */
const QE = new Uint16Array([
    0x5601, 0x3401, 0x1801, 0x0ac1, 0x0521, 0x0221, 0x5601, 0x5401, 0x4801, 0x3801, 0x3001, 0x2401, 0x1c01,
    0x1601, 0x5601, 0x5401, 0x5101, 0x4801, 0x3801, 0x3401, 0x3001, 0x2801, 0x2401, 0x2201, 0x1c01, 0x1801,
    0x1601, 0x1401, 0x1201, 0x1101, 0x0ac1, 0x09c1, 0x08a1, 0x0521, 0x0441, 0x02a1, 0x0221, 0x0141, 0x0111,
    0x0085, 0x0049, 0x0025, 0x0015, 0x0009, 0x0005, 0x0001, 0x5601,
]);
const NMPS = new Uint8Array([
    1, 2, 3, 4, 5, 38, 7, 8, 9, 10, 11, 12, 13, 29, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28,
    29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 45, 46,
]);
const NLPS = new Uint8Array([
    1, 6, 9, 12, 29, 33, 6, 14, 14, 14, 17, 18, 20, 21, 14, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 23, 24,
    25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 46,
]);
const SWITCH = new Uint8Array([
    1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
]);

/** Contexts of the tier-1 coder: 0-8 zero coding, 9-13 sign, 14-16 magnitude refinement, 17 run length, 18 uniform. */
const MQ_CONTEXTS = 19;
export const CTX_RUN = 17;
export const CTX_UNIFORM = 18;
/** Starting states: the first zero-coding context, the run-length context and the uniform context differ from state 0. */
const START_STATE: ReadonlyArray<readonly [number, number]> = [
    [0, 4],
    [CTX_RUN, 3],
    [CTX_UNIFORM, 46],
];

export class MqDecoder {
    /** State index per context. */
    private readonly state: Uint8Array;
    /** The more probable symbol per context. */
    private readonly mps: Uint8Array;
    private readonly data: Uint8Array;
    private bp: number;
    private a = 0x8000;
    private c = 0;
    private ct = 0;

    private memory: Memory;
    release(): void {
        this.memory.release(this.state);
        this.memory.release(this.mps);
    }
    constructor(data: Uint8Array);
    /** @internal */
    constructor(data: Uint8Array, memory?: Memory);
    constructor(data: Uint8Array, memory = new Memory()) {
        this.memory = memory;
        this.state = memory.array(Uint8Array, MQ_CONTEXTS);
        this.mps = memory.array(Uint8Array, MQ_CONTEXTS);
        this.data = data;
        for (const [ctx, state] of START_STATE) this.state[ctx] = state;
        this.bp = 0;
        this.c = this.byteAt(0) << 16;
        this.byteIn();
        this.c <<= 7;
        this.ct -= 7;
    }

    /** Bytes past the end read as 0xff, which the coder treats as the end-of-data marker. */
    private byteAt(i: number): number {
        return i < this.data.length ? this.data[i] : 0xff;
    }

    private byteIn(): void {
        if (this.byteAt(this.bp) === 0xff) {
            if (this.byteAt(this.bp + 1) > 0x8f) {
                this.c += 0xff00;
                this.ct = 8;
            } else {
                this.bp++;
                this.c += this.byteAt(this.bp) << 9;
                this.ct = 7;
            }
        } else {
            this.bp++;
            this.c += this.byteAt(this.bp) << 8;
            this.ct = 8;
        }
    }

    private renormalize(): void {
        do {
            if (this.ct === 0) this.byteIn();
            this.a = (this.a << 1) & 0xffff;
            this.c = (this.c << 1) >>> 0;
            this.ct--;
        } while ((this.a & 0x8000) === 0);
    }

    /** Decode one binary decision in a context. */
    decode(ctx: number): number {
        const s = this.state[ctx];
        const qe = QE[s];
        let d: number;
        this.a -= qe;
        if (this.c >>> 16 < qe) {
            // The less probable symbol's interval: the conditional exchange.
            if (this.a < qe) {
                d = this.mps[ctx];
                this.state[ctx] = NMPS[s];
            } else {
                d = 1 - this.mps[ctx];
                if (SWITCH[s]) this.mps[ctx] = 1 - this.mps[ctx];
                this.state[ctx] = NLPS[s];
            }
            this.a = qe;
            this.renormalize();
        } else {
            this.c -= qe << 16;
            if ((this.a & 0x8000) === 0) {
                if (this.a < qe) {
                    d = 1 - this.mps[ctx];
                    if (SWITCH[s]) this.mps[ctx] = 1 - this.mps[ctx];
                    this.state[ctx] = NLPS[s];
                } else {
                    d = this.mps[ctx];
                    this.state[ctx] = NMPS[s];
                }
                this.renormalize();
            } else {
                d = this.mps[ctx];
            }
        }
        return d;
    }
}
