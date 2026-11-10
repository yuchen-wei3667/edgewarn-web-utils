/** In-memory ResponseStore: drains bodies like Cache Storage, keeps entries until forgotten. */
export class FakeResponseStore {
    entries = new Map();
    disabled = false;
    failPut = false;
    configured = null;
    get totalBytes() { return [...this.entries.values()].reduce((n, e) => n + e.bytes.length, 0); }
    configure(maxBytes, maxAgeMs) { this.configured = { maxBytes, maxAgeMs }; }
    async get(url) {
        const entry = this.entries.get(url);
        if (!entry) return null;
        const headers = new Headers(entry.headers);
        headers.set('x-edgewarn-cache-stored-at', String(entry.storedAt));
        return new Response(entry.bytes.slice(), { headers });
    }
    async put(url, response, size, replace) {
        if (this.failPut) { await response.body?.cancel().catch(() => {}); return false; }
        let bytes;
        try { bytes = new Uint8Array(await response.arrayBuffer()); } catch { return false; }
        if (replace && this.entries.has(url) && !replace(await this.get(url))) return false;
        const expected = typeof size === 'function' ? size() : size;
        if (expected !== bytes.length) return false;
        this.entries.set(url, { bytes, headers: new Headers(response.headers), storedAt: Date.now() });
        return true;
    }
    async forget(url) { this.entries.delete(url); }
}

/** A fetch that serves `files` (url -> Uint8Array) in `chunk`-byte pieces and records calls. */
export function makeFetch(files, { chunk = 4096 } = {}) {
    const calls = [];
    const fetcher = async (url, init = {}) => {
        calls.push(url);
        const body = files.get(url);
        if (!body) return new Response('missing', { status: 404 });
        let pos = 0;
        let errored = false;
        const stream = new ReadableStream({
            start(controller) {
                init.signal?.addEventListener('abort', () => {
                    errored = true;
                    try { controller.error(new DOMException('Aborted', 'AbortError')); } catch { /* already closed */ }
                });
            },
            pull(controller) {
                if (errored) return;
                if (init.signal?.aborted) { controller.error(new DOMException('Aborted', 'AbortError')); return; }
                if (pos >= body.length) { controller.close(); return; }
                controller.enqueue(new Uint8Array(body.subarray(pos, pos + chunk)));
                pos += chunk;
            },
        }, { highWaterMark: 0 });
        return new Response(stream, { status: 200 });
    };
    return { fetcher, calls };
}

export const until = async (predicate, { timeout = 2000 } = {}) => {
    const start = Date.now();
    while (!predicate()) {
        if (Date.now() - start > timeout) throw new Error('timed out waiting for condition');
        await new Promise((r) => setTimeout(r, 2));
    }
};

/** Deterministic pseudo-random bytes. */
export const seededBytes = (n, seed = 1) => {
    let x = seed >>> 0 || 1;
    return Uint8Array.from({ length: n }, () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) >>> 24));
};
