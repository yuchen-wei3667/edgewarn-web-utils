/** Storage remains owned by the caller; no import-time browser access or timers. */
export type DismissalStorage = Pick<Storage, 'getItem' | 'setItem'>;
export interface DismissedAlert {
    id: string;
    expires: string;
    dismissedAt: number;
}
const STORAGE_KEY = 'edgewarn_dismissed_alerts';

export function getDismissedAlerts(
    storage: DismissalStorage,
    retentionMs: number,
    now = Date.now(),
): DismissedAlert[] {
    try {
        const stored = storage.getItem(STORAGE_KEY);
        if (!stored) return [];
        const parsed = JSON.parse(stored) as DismissedAlert[];
        const recent = parsed.filter(
            (d) =>
                Number.isFinite(d.dismissedAt) &&
                now - d.dismissedAt >= 0 &&
                now - d.dismissedAt < retentionMs,
        );
        storage.setItem(STORAGE_KEY, JSON.stringify(recent));
        return recent;
    } catch {
        return [];
    }
}

export function saveDismissedAlert(
    id: string,
    expires: string,
    storage: DismissalStorage,
    retentionMs: number,
    now = Date.now(),
): void {
    try {
        const dismissed = getDismissedAlerts(storage, retentionMs, now).filter((d) => d.id !== id);
        dismissed.push({ id, expires, dismissedAt: now });
        storage.setItem(STORAGE_KEY, JSON.stringify(dismissed));
        getDismissedAlerts(storage, retentionMs, now);
    } catch {
        /* Storage may be unavailable. */
    }
}
