import { Memory } from '../../internal/memory.ts';
const EMPTY = new Uint8Array(0);
const GZ0 = 0x1f;
const GZ1 = 0x8b;

/** Pull-based byte reader over a ReadableStream. Zero-copy when a request sits inside one chunk. */
export class ByteReader {
    reader: ReadableStreamDefaultReader<Uint8Array>;
    buf: Uint8Array = EMPTY;
    off = 0;
    /** Bytes handed out so far (for stats). */
    consumed = 0;

    private scratch: Uint8Array | undefined;
    readonly memory: Memory;
    constructor(stream: ReadableStream<Uint8Array>);
    /** @internal */
    constructor(stream: ReadableStream<Uint8Array>, memory?: Memory);
    constructor(stream: ReadableStream<Uint8Array>, memory = new Memory()) {
        this.memory = memory;
        this.reader = stream.getReader();
    }

    private async fill(): Promise<boolean> {
        for (;;) {
            const { value, done } = await this.reader.read();
            if (done) return false;
            if (value.length === 0) continue;
            this.buf = value;
            this.off = 0;
            return true;
        }
    }

    async read(n: number): Promise<Uint8Array> {
        if (!Number.isSafeInteger(n) || n < 0) throw new RangeError('Invalid read length');
        if (this.scratch) { this.memory.release(this.scratch); this.scratch = undefined; }
        if (this.buf.length - this.off >= n) {
            const s = this.buf.subarray(this.off, this.off + n);
            this.off += n;
            this.consumed += n;
            return s;
        }
        const out = this.scratch = this.memory.array(Uint8Array, n);
        let w = 0;
        while (w < n) {
            if (this.off >= this.buf.length && !(await this.fill())) throw new Error('Unexpected end of GRIB2 stream');
            const k = Math.min(n - w, this.buf.length - this.off);
            out.set(this.buf.subarray(this.off, this.off + k), w);
            this.off += k;
            w += k;
        }
        this.consumed += n;
        return out;
    }

    /** Zero-copy views totalling exactly n bytes. */
    async *take(n: number): AsyncGenerator<Uint8Array> {
        while (n > 0) {
            if (this.off >= this.buf.length && !(await this.fill())) throw new Error('Unexpected end of GRIB2 stream');
            const k = Math.min(n, this.buf.length - this.off);
            const s = this.buf.subarray(this.off, this.off + k);
            this.off += k;
            this.consumed += k;
            n -= k;
            yield s;
        }
    }

    async skip(n: number): Promise<void> {
        for await (const chunk of this.take(n)) void chunk;
    }

    cancel(): void {
        this.reader.cancel().catch(() => {}).finally(() => this.reader.releaseLock());
    }
}

export async function maybeGunzip(stream: ReadableStream<Uint8Array>, memory = new Memory(), signal?: AbortSignal): Promise<ReadableStream<Uint8Array>> {
    const rd = stream.getReader();
    const onAbort = () => { void rd.cancel(signal?.reason).catch(() => {}); };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
    signal?.throwIfAborted();
    let first = await rd.read();
    while (!first.done && first.value.length < 2) {
        // Extremely small first chunk: top it up so the two magic bytes can be checked.
        const next = await rd.read();
        if (next.done) break;
        const merged = memory.array(Uint8Array, first.value.length + next.value.length);
        merged.set(first.value, 0);
        merged.set(next.value, first.value.length);
        memory.release(first.value);
        first = { done: false, value: merged };
    }
    const head = first.done ? EMPTY : first.value;
    signal?.throwIfAborted();
    const replay = new ReadableStream<Uint8Array>({
        start(c) { if (head.length) c.enqueue(head); },
        async pull(c) {
            const { value, done } = await rd.read();
            if (done) { rd.releaseLock(); c.close(); } else c.enqueue(value);
        },
        cancel(reason) { return rd.cancel(reason).finally(() => rd.releaseLock()); },
    }, { highWaterMark: 0 });
    if (head[0] === GZ0 && head[1] === GZ1) {
        return replay.pipeThrough(new DecompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
    }
    return replay;
    } catch (error) {
        await rd.cancel(error).catch(() => {});
        rd.releaseLock();
        throw error;
    } finally {
        signal?.removeEventListener('abort', onAbort);
    }
}
