/** Per-operation backing-store accounting; never shared through module globals. */
export class DecodeBudgetExceededError extends Error {
    readonly limitBytes: number;
    readonly usedBytes: number;
    readonly requestedBytes: number;
    constructor(limitBytes: number, usedBytes: number, requestedBytes: number) {
        super(`Decoder memory limit ${limitBytes} exceeded: ${usedBytes} + ${requestedBytes} bytes`);
        this.name = 'DecodeBudgetExceededError';
        this.limitBytes = limitBytes;
        this.usedBytes = usedBytes;
        this.requestedBytes = requestedBytes;
    }
}
export class Memory {
    private buffers = new Set<ArrayBufferLike>();
    usedBytes = 0;
    peakBytes = 0;
    readonly limitBytes: number;
    constructor(limitBytes = Infinity) {
        this.limitBytes = limitBytes;
    }
    reserve(bytes: number): void {
        if (!Number.isSafeInteger(bytes) || bytes < 0)
            throw new RangeError('Invalid decoder allocation size');
        if (bytes > this.limitBytes - this.usedBytes)
            throw new DecodeBudgetExceededError(this.limitBytes, this.usedBytes, bytes);
        this.usedBytes += bytes;
        this.peakBytes = Math.max(this.peakBytes, this.usedBytes);
    }
    array<T extends ArrayBufferView>(
        ctor: { new (length: number): T; BYTES_PER_ELEMENT: number },
        length: number,
    ): T {
        if (!Number.isSafeInteger(length) || length < 0)
            throw new RangeError('Invalid decoder allocation length');
        if (this.limitBytes === Infinity) return new ctor(length);
        const bytes = length * ctor.BYTES_PER_ELEMENT;
        this.reserve(bytes);
        try {
            const value = new ctor(length);
            this.buffers.add(value.buffer);
            return value;
        } catch (error) {
            this.usedBytes -= bytes;
            throw error;
        }
    }
    release(value: ArrayBufferView): void {
        if (this.buffers.delete(value.buffer)) this.usedBytes -= value.buffer.byteLength;
    }
    clear(): void {
        this.buffers.clear();
        this.usedBytes = 0;
    }
}
