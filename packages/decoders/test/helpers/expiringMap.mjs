/** Maximum retention for runtime weather caches. Reads never extend an entry's lifetime. */
export const CACHE_RETENTION_MS = 6 * 60 * 60 * 1000;
/** A Map with absolute expiry, including cleanup when no one reads it again.
 * The timer holds only a weak reference, so component-owned caches can be collected.
 */
export class ExpiringMap extends Map {
    deadlines = new Map();
    timer = null;
    nextExpiry = Infinity;
    timerAt = Infinity;
    options;
    constructor(options = {}) {
        super();
        this.options = options;
    }
    now() { return this.options.now?.() ?? Date.now(); }
    prune() {
        const now = this.now();
        if (now < this.nextExpiry)
            return;
        this.nextExpiry = Infinity;
        for (const [key, deadline] of this.deadlines) {
            if (deadline > now) {
                this.nextExpiry = Math.min(this.nextExpiry, deadline);
                continue;
            }
            const value = super.get(key);
            super.delete(key);
            this.deadlines.delete(key);
            this.options.onExpire?.(value, key);
        }
        if (!this.deadlines.size && this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
            this.timerAt = Infinity;
        }
    }
    schedule() {
        if (!this.deadlines.size || (this.timer !== null && this.timerAt <= this.nextExpiry))
            return;
        if (this.timer !== null)
            clearTimeout(this.timer);
        this.timerAt = this.nextExpiry;
        const ref = new WeakRef(this);
        this.timer = setTimeout(() => {
            const cache = ref.deref();
            if (!cache)
                return;
            cache.timer = null;
            cache.timerAt = Infinity;
            cache.prune();
            cache.schedule();
        }, Math.max(1, this.nextExpiry - this.now()));
        // Node caches must not keep an otherwise idle process alive.
        this.timer.unref?.();
    }
    set(key, value, ttlMs = this.options.ttlMs ?? CACHE_RETENTION_MS) {
        this.prune();
        super.set(key, value);
        const deadline = this.now() + Math.min(ttlMs, CACHE_RETENTION_MS);
        this.deadlines.set(key, deadline);
        this.nextExpiry = Math.min(this.nextExpiry, deadline);
        this.schedule();
        return this;
    }
    get(key) { this.prune(); return super.get(key); }
    /** Move to the LRU tail without extending absolute expiry. */
    touch(key) {
        this.prune();
        if (!super.has(key))
            return;
        const value = super.get(key);
        super.delete(key);
        super.set(key, value);
    }
    /** Copy for immutable React state updates without renewing existing deadlines. */
    copy() {
        this.prune();
        const copy = new ExpiringMap(this.options);
        const now = this.now();
        for (const [key, value] of super.entries())
            copy.set(key, value, this.deadlines.get(key) - now);
        return copy;
    }
    has(key) { this.prune(); return super.has(key); }
    get size() { this.prune(); return super.size; }
    entries() { this.prune(); return super.entries(); }
    keys() { this.prune(); return super.keys(); }
    values() { this.prune(); return super.values(); }
    [Symbol.iterator]() { return this.entries(); }
    forEach(callback, thisArg) {
        this.prune();
        super.forEach(callback, thisArg);
    }
    delete(key) {
        this.deadlines.delete(key);
        const deleted = super.delete(key);
        if (!this.deadlines.size) {
            if (this.timer !== null)
                clearTimeout(this.timer);
            this.timer = null;
            this.timerAt = Infinity;
            this.nextExpiry = Infinity;
        }
        return deleted;
    }
    clear() {
        super.clear();
        this.deadlines.clear();
        if (this.timer !== null)
            clearTimeout(this.timer);
        this.timer = null;
        this.timerAt = Infinity;
        this.nextExpiry = Infinity;
    }
}
export class ExpiringSet {
    entries = new ExpiringMap();
    add(value) { this.entries.set(value, true); return this; }
    has(value) { return this.entries.has(value); }
    delete(value) { return this.entries.delete(value); }
    clear() { this.entries.clear(); }
    get size() { return this.entries.size; }
    [Symbol.iterator]() { return this.entries.keys(); }
}
