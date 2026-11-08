import { linkedAbortSignal } from '../fetch-with-timeout.ts';

type QueryParams = Record<string, string | number | undefined>;

export interface RequestOptions {
    /** Caller-supplied abort signal; aborting it cancels the request. */
    signal?: AbortSignal;
    /** Fetch cache mode. Defaults to 'no-store' for live data. */
    cache?: RequestCache;
    /** Abort the request after this many ms. Omit or 0 to disable. */
    timeoutMs?: number;
}

function buildUrl(baseUrl: string, path: string, params?: QueryParams): string {
    let url = `${baseUrl}${path}`;

    if (params) {
        const searchParams = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined) {
                searchParams.set(key, String(value));
            }
        });

        const searchString = searchParams.toString().replace(/%3A/g, ':');
        if (searchString) {
            url += `?${searchString}`;
        }
    }

    return url;
}

async function toErrorMessage(response: Response): Promise<string> {
    const base = `Server returned ${response.status}: ${response.statusText}`;

    try {
        const body = (await response.json()) as {
            error?: string | { message?: string };
            detail?: string;
            title?: string;
            requestId?: string;
        };

        const requestId = response.headers.get('X-Request-Id') ?? body.requestId;
        const suffix = requestId ? ` (request ${requestId})` : '';

        if (body.detail || body.title) return `${body.detail ?? body.title}${suffix}`;

        if (body?.error && typeof body.error === 'object' && body.error.message) {
            return `${base}: ${body.error.message}${suffix}`;
        }

        if (typeof body?.error === 'string') {
            return `${base}: ${body.error}${suffix}`;
        }

        return `${base}${suffix}`;
    } catch {
        return base;
    }
}

export function createJsonRequester(baseUrl: string) {
    return async function requestJson<T>(
        path: string,
        params?: QueryParams,
        options?: RequestOptions,
    ): Promise<T> {
        const { signal, cache = 'no-store', timeoutMs = 0 } = options ?? {};
        // The timeout and the caller's signal also cover reading the body.
        const linked = linkedAbortSignal(signal, timeoutMs);

        try {
            const response = await fetch(buildUrl(baseUrl, path, params), {
                headers: { Accept: 'application/json' },
                cache,
                signal: linked.signal,
            });

            if (!response.ok) {
                throw new Error(await toErrorMessage(response));
            }

            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                // Don't log the body — it can carry sensitive content. The
                // content-type and status are enough to diagnose.
                const body = await response.text();
                console.error('[EdgeWARNAPI] Non-JSON response', {
                    contentType,
                    status: response.status,
                    length: body.length,
                });
                throw new Error(`Server returned non-JSON content. Content-Type: ${contentType}`);
            }

            return (await response.json()) as T;
        } catch (error) {
            if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
                throw new Error(
                    `Failed to connect to API. Please check if the server is running at ${baseUrl}`,
                );
            }
            throw error;
        } finally {
            linked.dispose();
        }
    };
}
