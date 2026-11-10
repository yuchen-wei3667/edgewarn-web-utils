import test from 'node:test';
import assert from 'node:assert/strict';
import { CacheStoragePrefixStore } from '@edgewarn/web-utils/nexrad/feed';
import { FakeResponseStore } from './helpers/fakes.mjs';

const bytes = (n, fill = 1) => new Uint8Array(n).fill(fill);

test('keeps the longest prefix per key and drops a damaged entry on request', async () => {
    const store = new FakeResponseStore();
    const prefixes = new CacheStoragePrefixStore({ store, maxBytes: 1000 });
    assert.equal(await prefixes.get('a'), null);
    await prefixes.put('a', bytes(100, 1));
    await prefixes.put('a', bytes(50, 2));
    assert.deepEqual(await prefixes.get('a'), bytes(100, 1), 'a shorter prefix does not replace a longer one');
    await prefixes.put('a', bytes(200, 3));
    assert.deepEqual(await prefixes.get('a'), bytes(200, 3));
    await prefixes.forget('a');
    assert.equal(await prefixes.get('a'), null);
});

test('empty and oversized prefixes are not kept', async () => {
    const store = new FakeResponseStore();
    const prefixes = new CacheStoragePrefixStore({ store, maxBytes: 100 });
    await prefixes.put('a', bytes(0));
    await prefixes.put('b', bytes(101));
    assert.equal(store.entries.size, 0);
});

test('without a store, or when the store fails, every call is a quiet miss', async () => {
    for (const options of [{ maxBytes: 100 }, { store: null, maxBytes: 100 }]) {
        const prefixes = new CacheStoragePrefixStore(options);
        await prefixes.put('a', bytes(10));
        assert.equal(await prefixes.get('a'), null);
        await prefixes.forget('a');
    }
    const store = new FakeResponseStore();
    store.put = async () => { throw new Error('quota'); };
    await new CacheStoragePrefixStore({ store, maxBytes: 100 }).put('a', bytes(10));
});
