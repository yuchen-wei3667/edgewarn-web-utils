/** In-memory ResponseStore: drains bodies like Cache Storage and keeps entries until forgotten. */
export class FakeResponseStore {
    entries = new Map();
    disabled = false;
    failPut = false;
    configured = null;
    get totalBytes() {
        return [...this.entries.values()].reduce((n, e) => n + e.bytes.length, 0);
    }
    configure(maxBytes, maxAgeMs) {
        this.configured = { maxBytes, maxAgeMs };
    }
    async get(url) {
        const entry = this.entries.get(url);
        if (!entry) return null;
        const headers = new Headers(entry.headers);
        headers.set('x-edgewarn-cache-stored-at', String(entry.storedAt));
        return new Response(entry.bytes.slice(), { headers });
    }
    async put(url, response, size) {
        if (this.failPut) return false;
        const bytes = new Uint8Array(await response.arrayBuffer());
        if ((typeof size === 'function' ? size() : size) !== bytes.length) return false;
        this.entries.set(url, { bytes, headers: new Headers(response.headers), storedAt: Date.now() });
        return true;
    }
    async forget(url) {
        this.entries.delete(url);
    }
}
