import { Memory } from './internal/memory.ts';
import type { ByteSource } from './goes/source.ts';
import type { MrmsDecodeResult, ModelHalfResult, ModelLevelsResult } from './grib2/types.ts';
import type { decodeLevel3Radial } from './nexrad/level3/digitalRadial.ts';
import type { TvsProduct } from './nexrad/level3/tvs.ts';
import type { AbiGrid } from './goes/abi.ts';
import type { DecoderBudget, DecodeOptions, DecodeResult, Grib2MrmsOptions, Grib2HalfOptions, Grib2LevelsOptions, NexradLevel2Options, NexradRadialOptions, NexradTvsOptions, GoesOptions } from './types.ts';
export type * from './types.ts';
export { DecodeBudgetExceededError } from './internal/memory.ts';

type Input = Uint8Array | ReadableStream<Uint8Array> | ByteSource;

/** Decoding only. One operation at a time; input and caller-retained output are caller-owned. */
export class EdgeWARNDecoder {
    private readonly limitBytes: number;
    private active = false;
    constructor(budget: DecoderBudget) {
        const limitBytes = budget?.memoryLimitBytes;
        if (!Number.isSafeInteger(limitBytes) || limitBytes <= 0) throw new RangeError('memoryLimitBytes must be a positive safe integer');
        this.limitBytes = limitBytes;
    }
    decode(input: ReadableStream<Uint8Array>, options: Grib2MrmsOptions): Promise<MrmsDecodeResult>;
    decode(input: Uint8Array, options: Grib2HalfOptions): Promise<ModelHalfResult>;
    decode(input: Uint8Array, options: Grib2LevelsOptions): Promise<ModelLevelsResult>;
    decode(input: Uint8Array | ReadableStream<Uint8Array>, options: NexradLevel2Options): Promise<void>;
    decode(input: Uint8Array, options: NexradRadialOptions): Promise<ReturnType<typeof decodeLevel3Radial>>;
    decode(input: Uint8Array, options: NexradTvsOptions): Promise<TvsProduct | null>;
    decode(input: Uint8Array | ByteSource, options: GoesOptions): Promise<AbiGrid>;
    async decode(input: Input, options: DecodeOptions): Promise<DecodeResult> {
        if (this.active) throw new Error('Decoder already has an active decode');
        validate(input, options);
        this.active = true;
        const memory = new Memory(this.limitBytes);
        try {
            if ('signal' in options) options.signal?.throwIfAborted();
            if (options.format === 'grib2') {
                if (options.mode === 'mrms') {
                    const { decodeGrib2 } = await import('./grib2/mrms/decode.ts');
                    return await decodeGrib2(input as ReadableStream<Uint8Array>, options.sink, options, memory);
                }
                const model = await import('./grib2/models/grib2.ts');
                return options.output === 'half'
                    ? model.decodeGrib2ToHalf(input as Uint8Array, options.transform, memory)
                    : model.decodeGrib2ToLevels(input as Uint8Array, options, memory);
            }
            if (options.format === 'nexrad') {
                if (options.level === 2) {
                    const { NexradDecoder } = await import('./nexrad/decoder/decoder.ts');
                    const decoder = new NexradDecoder(options.onRadial, options, memory);
                    if (input instanceof Uint8Array) {
                        options.signal?.throwIfAborted();
                        decoder.push(input);
                    } else {
                        const reader = (input as ReadableStream<Uint8Array>).getReader();
                        const abort = () => { void reader.cancel(options.signal?.reason).catch(() => {}); };
                        options.signal?.addEventListener('abort', abort, { once: true });
                        try {
                            for (;;) {
                                options.signal?.throwIfAborted();
                                const { value, done } = await reader.read();
                                options.signal?.throwIfAborted();
                                if (done) break;
                                if (!(value instanceof Uint8Array)) throw new TypeError('Expected byte stream');
                                decoder.push(value);
                            }
                        } finally {
                            options.signal?.removeEventListener('abort', abort);
                            await reader.cancel().catch(() => {});
                            reader.releaseLock();
                        }
                    }
                    decoder.finish();
                    return;
                }
                if (options.product === 'tvs') {
                    const { parseTvsProduct } = await import('./nexrad/level3/tvs.ts');
                    return parseTvsProduct(input as Uint8Array);
                }
                const { decodeLevel3Radial } = await import('./nexrad/level3/digitalRadial.ts');
                return decodeLevel3Radial(input as Uint8Array, options.moment, memory);
            }
            const { AbiFile } = await import('./goes/abi.ts');
            const { BytesSource } = await import('./goes/source.ts');
            const source = input instanceof Uint8Array ? new BytesSource(input) : input as ByteSource;
            const file = await AbiFile.open(source, options.signal, options.dependencies, memory);
            return await file.read(options);
        } catch (error) {
            // A decoder can fail before acquiring its stream reader (e.g. workspace reservation).
            if (input instanceof ReadableStream && !input.locked) await input.cancel(error).catch(() => {});
            throw error;
        } finally {
            memory.clear();
            this.active = false;
        }
    }
}

function validate(input: Input, options: DecodeOptions): void {
    if (!options || typeof options !== 'object') throw new TypeError('Decode options required');
    const bytes = input instanceof Uint8Array;
    const stream = input instanceof ReadableStream;
    if (options.format === 'grib2') {
        if (options.mode === 'mrms' && stream && typeof options.sink?.begin === 'function' && typeof options.sink?.row === 'function') return;
        if (options.mode === 'model' && bytes && (options.output === 'half' || options.output === 'levels')) return;
    } else if (options.format === 'nexrad') {
        if (options.level === 2 && (bytes || stream) && typeof options.onRadial === 'function') return;
        if (options.level === 3 && bytes && (options.product === 'tvs' || (options.product === 'radial' && typeof options.moment === 'string'))) return;
    } else if (options.format === 'goes' && (bytes || (input && typeof (input as ByteSource).read === 'function'))) return;
    throw new TypeError('Invalid decoder format, mode, output, or input');
}
