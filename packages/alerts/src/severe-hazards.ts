import type { NWSAlertFeature } from '@edgewarn/web-utils/net';

export interface ParsedSevereHazards {
    wind: string | null;
    hail: string | null;
    hazard: string | null;
    tornadoConfirmation: 'confirmed' | 'radar-indicated' | null;
}

export function extractSevereHazards(feature: NWSAlertFeature): ParsedSevereHazards {
    const props = feature.properties;

    if (
        props.event !== 'Severe Thunderstorm Warning'
        && props.event !== 'Tornado Warning'
        && props.event !== 'Special Weather Statement'
    ) {
        return { wind: null, hail: null, hazard: null, tornadoConfirmation: null };
    }

    const textToScan = `\n${props.description || ''}\n${props.instruction || ''}`;
    let wind: string | null = null;
    let hail: string | null = null;
    let hazard: string | null = null;
    let tornadoConfirmation: 'confirmed' | 'radar-indicated' | null = null;

    const windTagMatch = textToScan.match(/\nMAX WIND GUST\s*\.\.\.\s*([<>]?\s*\d+\s*MPH)/i);
    const hailTagMatch = textToScan.match(/\nMAX HAIL SIZE\s*\.\.\.\s*([<>]?\s*\d+(?:\.\d+)?\s*IN)/i);

    if (windTagMatch) {
        wind = windTagMatch[1].trim().replace(/\s+/g, ' ');
    }

    if (hailTagMatch) {
        hail = hailTagMatch[1].trim().replace(/\s+/g, ' ');
    }

    if (!wind || !hail) {
        const hazardMatch = textToScan.match(/\nHAZARD\.\.\.([^\n]+)/i);

        if (hazardMatch) {
            const hazardText = hazardMatch[1].trim().replace(/\s+/g, ' ');
            hazard = hazardText;

            if (!wind) {
                const windMatch = hazardText.match(/(\d+\s*mph)(?:\s+wind\s+gusts?)?/i);
                if (windMatch) {
                    wind = windMatch[1].trim().replace(/\s+/g, ' ');
                }
            }

            if (!hail) {
                const hailParts = hazardText.split(/and|,/i);
                for (const part of hailParts) {
                    if (part.toLowerCase().includes('hail')) {
                        hail = part.replace(/hail\.?/i, '').trim();
                        if (hail) {
                            hail = hail.charAt(0).toUpperCase() + hail.slice(1);
                        }
                        break;
                    }
                }
            }
        }
    }

    if (props.event === 'Tornado Warning') {
        const sourceMatch = textToScan.match(/\nSOURCE\.\.\.([^\n]+)/i);
        const sourceText = sourceMatch?.[1].trim().replace(/\s+/g, ' ') || '';

        if (/radar indicated rotation/i.test(sourceText)) {
            tornadoConfirmation = 'radar-indicated';
        } else if (/confirm(?:ed|ation)?/i.test(sourceText)) {
            tornadoConfirmation = 'confirmed';
        }
    }

    return { wind, hail, hazard, tornadoConfirmation };
}
