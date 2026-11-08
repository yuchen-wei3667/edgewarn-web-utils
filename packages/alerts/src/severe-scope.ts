import type { NWSAlertFeature } from '@edgewarn/web-utils/net';

/** NWS alert events that belong in the Severe tab. Tropical/winter/heat/fire excluded. */
export function isSevereTabAlert(alert: NWSAlertFeature): boolean {
    const text = (alert.properties.event || '').toLowerCase();
    if (/hurricane|tropical|typhoon|cyclone|storm surge/.test(text)) return false;
    if (
        /winter|blizzard|sleet|snow|ice|freeze|frost|wind chill|heat|hot|cold|fog|dust|smoke|fire|red flag|volcano|tsunami|avalanche/.test(
            text,
        )
    )
        return false;
    return /(tornado|thunderstorm|severe|hail|wind|gust|flood|flash|excessive rain|hydrolog)/.test(text);
}
