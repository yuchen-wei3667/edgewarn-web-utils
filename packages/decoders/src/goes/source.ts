/**
 * Random-access byte sources for the HDF5 reader. Everything above this layer asks for
 * `(offset, length)` slices; nothing ever holds the whole file.
 */
export interface ByteSource {
    /** Resolve exactly `length` bytes starting at `offset`. The view may alias an internal buffer. */
    read(offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array>;
    /**
     * Optional: the same bytes as consecutive pieces, so large ranges never sit in memory whole.
     * A piece is only valid until the next one is requested; sources may reuse its buffer.
     */
    stream?(offset: number, length: number, signal?: AbortSignal): AsyncIterable<Uint8Array>;
    /** Bytes fetched from the backing store so far (for stats). */
    readonly bytesFetched: number;
    readonly requests: number;
    /** Optional: drop any buffered bytes. Later reads fetch again. */
    release?(): void;
}

/** A source over bytes already in memory (tests, or a file the caller has read). */
export class BytesSource implements ByteSource {
    bytesFetched = 0;
    requests = 0;
    private bytes: Uint8Array;
    constructor(bytes: Uint8Array) { this.bytes = bytes; }

    async read(offset: number, length: number): Promise<Uint8Array> {
        if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || length > this.bytes.length - offset) throw new RangeError(`Read past end: ${offset}+${length} > ${this.bytes.length}`);
        this.requests++;
        this.bytesFetched += length;
        return this.bytes.subarray(offset, offset + length);
    }

    async *stream(offset: number, length: number): AsyncIterable<Uint8Array> {
        yield await this.read(offset, length);
    }
}

