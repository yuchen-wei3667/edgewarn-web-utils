/** Normalizers for loosely typed fields in third-party JSON and CSV payloads. */

/** Trimmed string form of `value`; `fallback` for null or undefined. */
export function normalizeString(value: unknown, fallback = ''): string {
    if (typeof value === 'string') return value.trim();
    if (value === null || value === undefined) return fallback;
    return String(value).trim();
}

/** Trimmed string, or null when empty. */
export function normalizeNullableString(value: unknown): string | null {
    const normalized = normalizeString(value);
    return normalized.length > 0 ? normalized : null;
}

/** Finite number from a number or numeric string, otherwise null. */
export function normalizeNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}
