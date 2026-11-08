export function assertValidTimestamp(timestamp: string): void {
    if (!/^\d{8}-\d{6}$/.test(timestamp) && !/^\d{4}\.\d{2}\.\d{2}\.\d{2}\.\d{2}\.\d{2}$/.test(timestamp)) {
        throw new Error(
            `Invalid timestamp format: ${timestamp}. Expected YYYYMMDD-HHMMSS or YYYY.MM.DD.HH.MM.SS.`,
        );
    }
}
