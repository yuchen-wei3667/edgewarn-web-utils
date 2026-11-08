interface FetchTimeoutOptions extends Omit<RequestInit, 'signal'> {
    /** Caller-supplied abort signal; aborting it cancels the request. */
    signal?: AbortSignal;
    /** Abort the request after this many ms. Defaults to 15000; pass 0 to disable. */
    timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15000;

/**
 * One abort signal that fires when the caller's signal aborts or when
 * `timeoutMs` elapses (0 or less disables the timeout). Call `dispose` once the
 * work it guards is finished, so the timer and the listener are released.
 */
export function linkedAbortSignal(signal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
    const controller = new AbortController();
    const onExternalAbort = () => controller.abort(signal?.reason);
    if (signal) {
        if (signal.aborted) {
            controller.abort(signal.reason);
        } else {
            signal.addEventListener('abort', onExternalAbort, { once: true });
        }
    }
    const timeoutId = timeoutMs > 0
        ? setTimeout(
            () => controller.abort(new DOMException('Request timed out', 'TimeoutError')),
            timeoutMs,
        )
        : undefined;
    return {
        signal: controller.signal,
        dispose: () => {
            if (timeoutId !== undefined) clearTimeout(timeoutId);
            if (signal) signal.removeEventListener('abort', onExternalAbort);
        },
    };
}

/**
 * `fetch` wrapper that enforces a request timeout and honors a caller-supplied
 * abort signal. Either the timeout firing or the external signal aborting will
 * cancel the in-flight request. Use this for external (NWS/SPC/WPC/etc.) calls
 * so a hung upstream connection can't block indefinitely.
 */
export async function fetchWithTimeout(
    input: string | URL,
    options: FetchTimeoutOptions = {},
): Promise<Response> {
    const { signal, timeoutMs = DEFAULT_TIMEOUT_MS, ...init } = options;
    const linked = linkedAbortSignal(signal, timeoutMs);
    try {
        return await fetch(input, { ...init, signal: linked.signal });
    } finally {
        linked.dispose();
    }
}
