/** Sorted object keys make message construction order irrelevant to cache identity. */
export function comparisonHash(value: unknown): string {
    const canonical = (v: unknown): unknown =>
        Array.isArray(v)
            ? v.map(canonical)
            : v && typeof v === 'object'
              ? Object.fromEntries(
                    Object.entries(v)
                        .filter(([, x]) => x !== undefined)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([k, x]) => [k, canonical(x)]),
                )
              : v;
    const text = JSON.stringify(canonical(value));
    let hash = BigInt('14695981039346656037');
    for (let i = 0; i < text.length; i++)
        hash = BigInt.asUintN(64, (hash ^ BigInt(text.charCodeAt(i))) * BigInt('1099511628211'));
    return hash.toString(16).padStart(16, '0');
}
