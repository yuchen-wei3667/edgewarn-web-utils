import { auditPacking } from '../../../../internal/audited.ts';
import { Memory } from '../../../../internal/memory.ts';
import { u16 } from '../../../sections.ts';
import type { PackedField, ValueSink } from '../../grib2.ts';

/**
 * CCSDS 121.0 adaptive entropy coding, the packing ECMWF writes its open data in (GRIB2 data representation
 * template 5.42). A stream is a run of reference sample intervals (RSIs) of `rsi` blocks of `blockSize` samples.
 * Each block opens with an ID: 0 for a zero-block run or a second-extension pair code, the all-ones ID for raw
 * samples, anything else for a split with `ID - 1` low bits. With the preprocessor on, the first block of an
 * RSI also carries one reference sample and the others carry mapped prediction errors (a unit-delay predictor).
 * Written from the standard; the layout of each option matches libaec, which ecCodes uses.
 */

/** CCSDS flag bits in octet 22 of section 5 (libaec's `AEC_DATA_*` set). */
const FLAG_SIGNED = 1;
const FLAG_PREPROCESS = 8;
const FLAG_RESTRICTED = 16;
const FLAG_PAD_RSI = 32;

/** In a zero-block code, a count of this many means "the rest of the 64-block segment". */
const ZERO_BLOCKS_ROS = 5;
const SEGMENT_BLOCKS = 64;
const BLOCK_SIZES: readonly number[] = [8, 16, 32, 64];
const MAX_BITS_PER_SAMPLE = 32;

interface CcsdsParams {
    bitsPerSample: number;
    blockSize: number;
    /** Blocks per reference sample interval. */
    rsi: number;
    flags: number;
    nSamples: number;
}

class BitReader {
    pos = 0;
    private readonly data: Uint8Array;
    constructor(data: Uint8Array) {
        this.data = data;
    }

    private overrun(): never {
        throw new Error('CCSDS stream ends before the last sample');
    }

    /** n (0..32) bits, MSB first. */
    read(n: number): number {
        if (n === 0) return 0;
        if (n > 16) return this.read(n - 16) * 65536 + this.read(16);
        if (this.pos + n > this.data.length * 8) this.overrun();
        const i = this.pos >>> 3;
        const word = (this.data[i] << 16) | (this.data[i + 1] << 8) | this.data[i + 2];
        const v = (word >>> (24 - (this.pos & 7) - n)) & ((1 << n) - 1);
        this.pos += n;
        return v;
    }

    /** A fundamental sequence: the number of 0 bits before the next 1, which is consumed. */
    unary(): number {
        let zeros = 0;
        for (;;) {
            const i = this.pos >>> 3;
            if (i >= this.data.length) this.overrun();
            const used = this.pos & 7;
            const rest = this.data[i] & (0xff >>> used);
            if (rest !== 0) {
                const lead = Math.clz32(rest) - 24 - used;
                this.pos += lead + 1;
                return zeros + lead;
            }
            zeros += 8 - used;
            this.pos = (i + 1) * 8;
        }
    }

    alignToByte(): void {
        this.pos = (this.pos + 7) & ~7;
    }
}

/** The pair (a, b) a second-extension code `m` stands for: m = T(a + b) + b with T(g) = g (g + 1) / 2. */
function secondExtensionPair(m: number, out: Int32Array): void {
    let g = Math.floor((Math.sqrt(8 * m + 1) - 1) / 2);
    while ((g * (g + 1)) / 2 > m) g--;
    while (((g + 1) * (g + 2)) / 2 <= m) g++;
    const b = m - (g * (g + 1)) / 2;
    out[0] = g - b;
    out[1] = b;
}

/** Decode `nSamples` unsigned samples. Throws on the options this reader does not cover (signed and restricted). */

export function decodeCcsds(data: Uint8Array, p: CcsdsParams): Uint32Array;
/** @internal */

export function decodeCcsds(data: Uint8Array, p: CcsdsParams, memory?: Memory): Uint32Array;
export function decodeCcsds(data: Uint8Array, p: CcsdsParams, memory = new Memory()): Uint32Array {
    const { bitsPerSample: n, blockSize: J, rsi, flags, nSamples } = p;
    if (!(n >= 1 && n <= MAX_BITS_PER_SAMPLE)) throw new Error(`CCSDS bits per sample ${n} not supported`);
    if (!BLOCK_SIZES.includes(J)) throw new Error(`CCSDS block size ${J} not supported`);
    if (!(rsi >= 1)) throw new Error(`CCSDS reference sample interval ${rsi} not supported`);
    if (flags & FLAG_SIGNED) throw new Error('CCSDS signed samples not supported');
    if (flags & FLAG_RESTRICTED) throw new Error('CCSDS restricted code options not supported');
    const preprocess = (flags & FLAG_PREPROCESS) !== 0;
    const padRsi = (flags & FLAG_PAD_RSI) !== 0;
    const idLen = n > 16 ? 5 : n > 8 ? 4 : 3;
    const rawId = (1 << idLen) - 1;
    const xmax = 2 ** n - 1;

    const out = memory.array(Uint32Array, nSamples);
    const blk = memory.array(Float64Array, J);
    const pair = memory.array(Int32Array, 2);
    const r = new BitReader(data);
    let o = 0;
    let prev = 0;

    /** Turn the block's decoded numbers into samples (undoing the predictor) and append them. */
    const emit = (hasRef: boolean): void => {
        const count = Math.min(J, nSamples - o);
        let i = 0;
        if (preprocess) {
            if (hasRef) prev = blk[i++];
            for (; i < count; i++) {
                const d = blk[i];
                const theta = Math.min(prev, xmax - prev);
                if (d <= 2 * theta) prev += d % 2 === 1 ? -(d + 1) / 2 : d / 2;
                else prev += theta === prev ? d - theta : theta - d;
                blk[i] = prev;
            }
            // Past `count` the block is padding; nothing reads it.
        }
        for (let k = 0; k < count; k++) out[o + k] = blk[k];
        o += count;
    };

    while (o < nSamples) {
        for (let b = 0; b < rsi && o < nSamples; b++) {
            const hasRef = preprocess && b === 0;
            const first = hasRef ? 1 : 0;
            const id = r.read(idLen);
            if (id === 0) {
                const secondExtension = r.read(1) === 1;
                const ref = hasRef ? r.read(n) : 0;
                if (secondExtension) {
                    if (hasRef) blk[0] = ref;
                    for (let i = first; i < J;) {
                        const m = r.unary();
                        secondExtensionPair(m, pair);
                        // Pairs sit on even positions; a reference sample takes the first slot of the first pair.
                        if ((i & 1) === 0) blk[i++] = pair[0];
                        blk[i++] = pair[1];
                    }
                    emit(hasRef);
                } else {
                    let zeroBlocks = r.unary() + 1;
                    if (zeroBlocks === ZERO_BLOCKS_ROS) zeroBlocks = SEGMENT_BLOCKS - (b % SEGMENT_BLOCKS);
                    else if (zeroBlocks > ZERO_BLOCKS_ROS) zeroBlocks--;
                    for (let z = 0; z < zeroBlocks && o < nSamples; z++) {
                        blk.fill(0);
                        if (z === 0 && hasRef) blk[0] = ref;
                        emit(z === 0 && hasRef);
                    }
                    b += zeroBlocks - 1;
                }
            } else if (id === rawId) {
                for (let i = 0; i < J; i++) blk[i] = r.read(n);
                emit(hasRef);
            } else {
                const k = id - 1;
                if (hasRef) blk[0] = r.read(n);
                for (let i = first; i < J; i++) blk[i] = r.unary();
                if (k > 0) for (let i = first; i < J; i++) blk[i] = blk[i] * 2 ** k + r.read(k);
                emit(hasRef);
            }
        }
        if (padRsi) r.alignToByte();
    }
    memory.release(blk);
    memory.release(pair);
    return out;
}

/** Packing decoder for template 5.42 (`registerPacking`). Octets 22-25 of section 5 hold the options. */

function decodeCcsdsFieldImpl(field: PackedField, sink: ValueSink): void;
/** @internal */

function decodeCcsdsFieldImpl(field: PackedField, sink: ValueSink, memory?: Memory): void;
function decodeCcsdsFieldImpl(field: PackedField, sink: ValueSink, memory = new Memory()): void {
    const { s5, s7, nValues, nbits, base, step } = field;
    const samples = decodeCcsds(s7, { bitsPerSample: nbits, flags: s5[21], blockSize: s5[22], rsi: u16(s5, 23), nSamples: nValues }, memory);
    for (let i = 0; i < nValues; i++) sink.value(base + samples[i] * step);
    memory.release(samples);
}

export const decodeCcsdsField = /* @__PURE__ */ auditPacking(decodeCcsdsFieldImpl);
