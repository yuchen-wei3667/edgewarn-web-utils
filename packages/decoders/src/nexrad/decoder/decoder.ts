import { Memory } from '../../internal/memory.ts';
import { Bzip2Decoder } from './bzip2.ts';
import { parseVcp } from './vcp.ts';
import type { Vcp } from './vcp.ts';

export interface Moment {
    name: string;
    gates: number;
    firstGateMeters: number;
    gateSpacingMeters: number;
    wordSize: 8 | 16;
    scale: number;
    offset: number;
    /** Big-endian raw samples; borrowed until the callback returns. 0=missing, 1=range-folded. */
    raw: Uint8Array;
}
export interface Radial {
    station: string;
    timeMs: number;
    azimuthNumber: number;
    azimuth: number;
    elevationNumber: number;
    elevation: number;
    status: number;
    moments: Moment[];
}
export function sample(moment: Moment, gate: number): number {
    if (!Number.isInteger(gate) || gate < 0 || gate >= moment.gates)
        throw new RangeError('Gate outside moment');
    const raw =
        moment.wordSize === 8 ? moment.raw[gate] : moment.raw[gate * 2] * 256 + moment.raw[gate * 2 + 1];
    return raw === 0 ? NaN : raw === 1 ? -Infinity : (raw - moment.offset) / moment.scale;
}
export function materialize(moment: Moment): Float32Array {
    const result = new Float32Array(moment.gates);
    for (let i = 0; i < result.length; i++) result[i] = sample(moment, i);
    return result;
}
const ascii = (a: Uint8Array, p: number, n: number) => String.fromCharCode(...a.subarray(p, p + n)).trim();
/** Bounded compacting queue. No concatenation on every network packet. */
class Queue {
    buffer: Uint8Array;
    start = 0;
    end = 0;
    private memory: Memory;
    readonly limit: number;
    constructor(limit: number);
    /** @internal */
    constructor(limit: number, memory?: Memory);
    constructor(limit: number, memory = new Memory()) {
        this.memory = memory;
        if (!Number.isSafeInteger(limit) || limit < 28 || limit > 64 * 1024 * 1024)
            throw new Error('Invalid buffer limit');
        this.limit = limit;
        this.buffer = memory.array(Uint8Array, Math.min(4096, limit));
    }
    get length() {
        return this.end - this.start;
    }
    append(a: Uint8Array) {
        if (this.length + a.length > this.limit) throw new Error('Buffer limit exceeded');
        if (this.end + a.length > this.buffer.length) {
            if (this.length + a.length <= this.buffer.length) this.buffer.copyWithin(0, this.start, this.end);
            else {
                const next = this.memory.array(
                    Uint8Array,
                    Math.min(this.limit, Math.max(this.buffer.length * 2, this.length + a.length)),
                );
                next.set(this.buffer.subarray(this.start, this.end));
                this.memory.release(this.buffer);
                this.buffer = next;
            }
            this.end -= this.start;
            this.start = 0;
        }
        this.buffer.set(a, this.end);
        this.end += a.length;
    }
    take(n: number) {
        const a = this.buffer.subarray(this.start, this.start + n);
        this.start += n;
        if (this.start === this.end) this.start = this.end = 0;
        return a;
    }
    view() {
        return new DataView(this.buffer.buffer, this.start, this.length);
    }
}
export class MessageDecoder {
    private queue: Queue;
    radials = 0;
    messages = 0;
    gates = 0;
    volumeEnded = false;
    messageTypes: Record<number, number> = {};
    private readonly onRadial: (radial: Radial) => void;
    private readonly onVcp: ((vcp: Vcp) => void) | undefined;
    constructor(onRadial: (radial: Radial) => void, onVcp?: (vcp: Vcp) => void);
    /** @internal */
    constructor(onRadial: (radial: Radial) => void, onVcp?: (vcp: Vcp) => void, memory?: Memory);
    constructor(onRadial: (radial: Radial) => void, onVcp?: (vcp: Vcp) => void, memory = new Memory()) {
        this.queue = new Queue(16 * 1024 * 1024, memory);
        this.onRadial = onRadial;
        this.onVcp = onVcp;
    }
    get workspaceBytes() {
        return this.queue.buffer.byteLength;
    }
    push(bytes: Uint8Array) {
        // Keep appends bounded even if the caller provides a complete uncompressed volume.
        for (let p = 0; p < bytes.length; p += 65536) {
            this.queue.append(bytes.subarray(p, p + 65536));
            this.drain();
        }
    }
    private drain() {
        while (this.queue.length >= 28) {
            const v = this.queue.view(),
                type = v.getUint8(15),
                words = v.getUint16(12);
            let length = type === 31 ? words * 2 + 12 : 2432;
            if (type === 29)
                length = 28 + (words === 65535 ? v.getUint16(24) * 65536 + v.getUint16(26) : words);
            if (length < 28 || length > this.queue.limit)
                throw new Error(`Invalid message ${type} length ${length}`);
            if (this.queue.length < length) return;
            const record = this.queue.take(length);
            this.messages++;
            this.messageTypes[type] = (this.messageTypes[type] ?? 0) + 1;
            if (type === 1)
                throw new Error('Legacy message 1 unsupported; this prototype targets modern message 31');
            if (type === 5 && this.onVcp) this.onVcp(parseVcp(record.subarray(28)));
            if (type !== 31) continue;
            if (v.getUint16(24) > 1) throw new Error('Segmented message 31 unsupported');
            const a = record.subarray(28),
                d = new DataView(a.buffer, a.byteOffset, a.byteLength);
            if (a.length < 32 || d.getUint8(16) !== 0) throw new Error('Invalid/compressed message 31');
            const count = d.getUint16(30);
            if (count > 10 || a.length < 32 + 4 * count) throw new Error('Invalid message 31 pointer count');
            const radial: Radial = {
                station: ascii(a, 0, 4),
                timeMs: (d.getUint16(8) - 1) * 86400000 + d.getUint32(4),
                azimuthNumber: d.getUint16(10),
                azimuth: d.getFloat32(12),
                elevationNumber: a[22],
                elevation: d.getFloat32(24),
                status: a[21],
                moments: [],
            };
            if (
                !Number.isFinite(radial.azimuth) ||
                radial.azimuth < 0 ||
                radial.azimuth > 360 ||
                !Number.isFinite(radial.elevation)
            )
                throw new Error('Invalid radial angles');
            for (let i = 0; i < count; i++) {
                const p = d.getUint32(32 + i * 4);
                if (!p) continue;
                if (p < 32 + count * 4 || p + 4 > a.length) throw new Error('Invalid data block pointer');
                if (a[p] !== 68) continue; // R: volume/elevation/radial constants, not gate moments.
                if (p + 28 > a.length) throw new Error('Truncated moment header');
                const gates = d.getUint16(p + 8),
                    wordSize = a[p + 19];
                if (wordSize !== 8 && wordSize !== 16) throw new Error('Unsupported moment word size');
                const end = p + 28 + gates * (wordSize / 8);
                if (end > a.length) throw new Error('Truncated moment samples');
                const scale = d.getFloat32(p + 20),
                    offset = d.getFloat32(p + 24);
                if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(offset))
                    throw new Error('Invalid moment scaling');
                radial.moments.push({
                    name: ascii(a, p + 1, 3),
                    gates,
                    firstGateMeters: d.getInt16(p + 10),
                    gateSpacingMeters: d.getInt16(p + 12),
                    wordSize,
                    scale,
                    offset,
                    raw: a.subarray(p + 28, end),
                });
                this.gates += gates;
            }
            this.radials++;
            this.volumeEnded ||= radial.status === 4;
            this.onRadial(radial);
        }
    }
    finish() {
        if (this.queue.length) throw new Error(`Truncated NEXRAD message: ${this.queue.length} bytes remain`);
    }
}
export interface DecoderOptions {
    maxCompressedRecordBytes?: number;
    maxDecodedRecordBytes?: number;
    onVcp?: (vcp: Vcp) => void;
}
/** Ordered Archive-II bytes: archive header followed by signed length + BZh records.
 * push() is synchronous/backpressured. Emit verified radials per compression record.
 * Callbacks borrow buffers; copy raw or materialize() to keep samples.
 */
export class NexradDecoder {
    private input: Queue;
    private decoded: Queue;
    private bzip: Bzip2Decoder;
    private header = false;
    private ended = false;
    private failed = false;
    private busy = false;
    readonly parser: MessageDecoder;
    station = '';
    compressionRecords = 0;
    inputBytes = 0;
    decodedBytes = 0;
    constructor(onRadial: (radial: Radial) => void, options?: DecoderOptions);
    /** @internal */
    constructor(onRadial: (radial: Radial) => void, options?: DecoderOptions, memory?: Memory);
    constructor(onRadial: (radial: Radial) => void, options: DecoderOptions = {}, memory = new Memory()) {
        this.bzip = new Bzip2Decoder(memory);
        this.input = new Queue((options.maxCompressedRecordBytes ?? 8 * 1024 * 1024) + 4, memory);
        this.decoded = new Queue(options.maxDecodedRecordBytes ?? 16 * 1024 * 1024, memory);
        this.parser = new MessageDecoder(onRadial, options.onVcp, memory);
    }
    get workspaceBytes() {
        return (
            this.input.buffer.byteLength +
            this.decoded.buffer.byteLength +
            this.bzip.workspaceBytes +
            this.parser.workspaceBytes
        );
    }
    push(bytes: Uint8Array) {
        if (this.failed || this.ended || this.busy) throw new Error('Decoder failed, finished, or reentered');
        this.busy = true;
        try {
            this.inputBytes += bytes.length;
            for (let p = 0; p < bytes.length;) {
                const n = Math.min(65536, bytes.length - p, this.input.limit - this.input.length);
                if (!n) throw new Error('Compressed record exceeds limit');
                this.input.append(bytes.subarray(p, p + n));
                p += n;
                this.drain();
            }
        } catch (error) {
            this.failed = true;
            throw error;
        } finally {
            this.busy = false;
        }
    }
    private drain() {
        if (!this.header) {
            if (this.input.length < 24) return;
            const h = this.input.take(24);
            if (ascii(h, 0, 8) !== 'AR2V0006') throw new Error('Expected modern AR2V0006 volume header');
            this.station = ascii(h, 20, 4);
            this.header = true;
        }
        while (this.input.length >= 4) {
            const size = Math.abs(this.input.view().getInt32(0));
            if (!size || size + 4 > this.input.limit) throw new Error('Invalid compression record size');
            if (this.input.length < size + 4) return;
            this.input.take(4);
            const compressed = this.input.take(size);
            // Validate CRCs before exposing data from this record; never publish corrupt radials.
            this.bzip.decode(compressed, (bytes) => this.decoded.append(bytes), this.decoded.limit);
            const result = this.decoded.take(this.decoded.length);
            this.decodedBytes += result.length;
            this.compressionRecords++;
            this.parser.push(result);
        }
    }
    finish(requireVolumeEnd = true) {
        if (this.failed || this.ended || this.busy) throw new Error('Decoder failed, finished, or reentered');
        if (!this.header || this.input.length) throw new Error('Truncated Archive-II stream');
        this.parser.finish();
        if (requireVolumeEnd && !this.parser.volumeEnded) throw new Error('Missing end-of-volume radial');
        this.ended = true;
    }
}

/** Read the VCP from the first bytes of a volume (archive object prefix or the `S` chunk). Null if it is not in `bytes`. */
export function readVcpFromPrefix(bytes: Uint8Array): Vcp | null {
    let found: Vcp | null = null;
    const decoder = new NexradDecoder(() => {}, {
        onVcp: (vcp) => {
            found ??= vcp;
        },
    });
    try {
        decoder.push(bytes);
    } catch {
        /* a cut-off second record is fine; only the first is needed */
    }
    return found;
}
