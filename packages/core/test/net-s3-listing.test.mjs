import test from 'node:test';
import assert from 'node:assert/strict';
import { parseS3Listing, listS3Pages } from '@edgewarn/web-utils/net';

const xml = ({ keys = [], prefixes = [], token = null, truncated = token !== null } = {}) =>
    `<?xml version="1.0"?><ListBucketResult>${keys
        .map(([key, size]) => `<Contents><Key>${key}</Key>${size === undefined ? '' : `<Size>${size}</Size>`}</Contents>`)
        .join('')}${prefixes.map((p) => `<CommonPrefixes><Prefix>${p}</Prefix></CommonPrefixes>`).join('')}<IsTruncated>${truncated}</IsTruncated>${token ? `<NextContinuationToken>${token}</NextContinuationToken>` : ''}</ListBucketResult>`;

test('parseS3Listing reads keys, sizes, prefixes and decodes XML entities', () => {
    const page = parseS3Listing(
        xml({ keys: [['a/b&amp;c.grib2.gz', 12], ['no-size.txt']], prefixes: ['a/&quot;x&quot;/'], token: 'tok&amp;1' }),
    );
    assert.deepEqual(page.objects, [
        { key: 'a/b&c.grib2.gz', size: 12 },
        { key: 'no-size.txt', size: 0 },
    ]);
    assert.deepEqual(page.prefixes, ['a/"x"/']);
    assert.equal(page.nextToken, 'tok&1');
});

test('parseS3Listing ignores a token on a page that is not truncated and tolerates empty XML', () => {
    assert.equal(parseS3Listing(xml({ keys: [['k', 1]], token: 'ignored', truncated: false })).nextToken, null);
    assert.deepEqual(parseS3Listing(''), { objects: [], prefixes: [], nextToken: null });
});

test('listS3Pages follows continuation tokens and builds the ListObjectsV2 query', async () => {
    const urls = [];
    const pages = [xml({ keys: [['one', 1]], token: 'T1' }), xml({ keys: [['two', 2]] })];
    const fetcher = async (url) => {
        urls.push(url);
        return new Response(pages.shift());
    };
    const seen = [];
    await listS3Pages('https://bucket.example', { prefix: 'p/', delimiter: '/' }, { fetcher, label: 'TEST' }, (page) =>
        seen.push(...page.objects.map((o) => o.key)),
    );
    assert.deepEqual(seen, ['one', 'two']);
    assert.equal(urls[0], 'https://bucket.example/?list-type=2&prefix=p%2F&delimiter=%2F');
    assert.equal(urls[1], 'https://bucket.example/?list-type=2&prefix=p%2F&delimiter=%2F&continuation-token=T1');
});

test('listS3Pages reads one page with allPages false, passes the signal and names the stack on failure', async () => {
    let calls = 0;
    const signal = new AbortController().signal;
    const fetcher = async (_url, init) => {
        calls++;
        assert.equal(init.signal, signal);
        return new Response(xml({ keys: [['k', 1]], token: 'T' }));
    };
    await listS3Pages('https://b', {}, { fetcher, label: 'X', allPages: false, signal }, () => {});
    assert.equal(calls, 1);
    await assert.rejects(
        listS3Pages('https://b', {}, { fetcher: async () => new Response('', { status: 503 }), label: 'MRMS' }, () => {}),
        /MRMS listing failed: HTTP 503/,
    );
});
