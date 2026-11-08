import type { NWSAlertFeature } from '@edgewarn/web-utils/net';
import {
    tornadoAlertText,
    isTornadoWarning,
    isTornadoEmergency,
    isPdsTornado,
    isConfirmedTornado,
} from './tornado-severity.ts';
import { extractSevereHazards } from './severe-hazards.ts';

const eventOf = (alert: NWSAlertFeature) => (alert.properties.event || '').trim();

/** @experimental Presentation policy; behavior may change in any release. */
export function isFlashFloodEmergency(alert: NWSAlertFeature): boolean {
    return /flash flood emergency/i.test(tornadoAlertText(alert));
}

/** @experimental Presentation policy; behavior may change in any release. */
export function hazardParts(alert: NWSAlertFeature): string[] {
    const parsed = extractSevereHazards(alert);
    const parts: string[] = [];
    if (parsed.hazard) {
        parts.push(parsed.hazard);
    } else {
        if (parsed.wind) parts.push(`${parsed.wind} winds`);
        if (parsed.hail) parts.push(`${parsed.hail} hail`);
    }
    if (parsed.tornadoConfirmation === 'confirmed') parts.push('confirmed tornado');
    else if (parsed.tornadoConfirmation === 'radar-indicated') parts.push('radar-indicated rotation');
    return parts;
}

const sentence = (text: string) =>
    `${text.charAt(0).toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? '' : '.'}`;

/** "Up to 70 mph winds and 1.75 inch hail." */
/** @experimental Presentation policy; behavior may change in any release. */
export function hazardLine(alert: NWSAlertFeature): string | null {
    const parsed = extractSevereHazards(alert);
    const number = (value: string | null) => value?.match(/\d+(?:\.\d+)?/)?.[0] ?? null;
    const wind = number(parsed.wind);
    const hail = number(parsed.hail);
    const lines: string[] = [];
    if (wind && hail) lines.push(`Up to ${wind} mph winds and ${hail} inch hail.`);
    else if (wind) lines.push(`Up to ${wind} mph winds.`);
    else if (hail) lines.push(`Up to ${hail} inch hail.`);
    else if (parsed.hazard) lines.push(sentence(parsed.hazard.toLowerCase()));
    if (parsed.tornadoConfirmation === 'radar-indicated') lines.push('Radar-indicated rotation.');
    return lines.length ? lines.join(' ') : null;
}

export interface WarningCopy {
    title: string;
    /** Inverted strip across the top of an emergency sign. */
    band: string | null;
    /** One line under the band, emergencies only. */
    lead: string | null;
    command: string;
}

/** Plain-language copy for an alert on the sign. Commands follow NWS safety guidance. */
/** @experimental Presentation policy; behavior may change in any release. */
export function warningCopy(alert: NWSAlertFeature): WarningCopy {
    const event = eventOf(alert) || 'Weather alert';
    const lower = event.toLowerCase();
    if (isTornadoWarning(alert)) {
        const command = 'Go to a basement or an interior room on the lowest floor now.';
        if (isTornadoEmergency(alert) || isPdsTornado(alert) || isConfirmedTornado(alert)) {
            return {
                title: isTornadoEmergency(alert) ? 'Tornado emergency' : event,
                band: 'Take cover now',
                lead: 'A confirmed tornado is near you.',
                command,
            };
        }
        return { title: event, band: null, lead: null, command };
    }
    if (lower === 'flash flood warning') {
        const command = 'Move to higher ground. Never drive through flooded roads.';
        if (isFlashFloodEmergency(alert)) {
            return {
                title: 'Flash flood emergency',
                band: 'Get to higher ground now',
                lead: 'Life-threatening flash flooding is happening now.',
                command,
            };
        }
        return { title: event, band: null, lead: null, command };
    }
    if (lower === 'severe thunderstorm warning')
        return { title: event, band: null, lead: null, command: 'Move indoors, away from windows.' };
    if (lower === 'tornado watch')
        return {
            title: event,
            band: null,
            lead: null,
            command: 'Tornadoes are possible. Know where you’d shelter and keep alerts on.',
        };
    if (lower === 'severe thunderstorm watch')
        return {
            title: event,
            band: null,
            lead: null,
            command: 'Severe storms are possible. Keep alerts on and be ready to move indoors.',
        };
    if (lower === 'flash flood watch' || lower === 'flood watch')
        return {
            title: event,
            band: null,
            lead: null,
            command: 'Flash flooding is possible. Avoid low roads if heavy rain starts.',
        };
    if (lower === 'special weather statement')
        return {
            title: 'Strong storm nearby',
            band: null,
            lead: null,
            command: 'A strong storm is near you. Move indoors if you hear thunder.',
        };
    return { title: event, band: null, lead: null, command: 'Move indoors and keep alerts on.' };
}

/** @experimental Presentation policy; behavior may change in any release. */
export function heroTitleForAlert(alert: NWSAlertFeature): string {
    if (/^special weather statement$/i.test(alert.properties.event || ''))
        return 'Thunderstorm activity — stay weather aware';
    if (isTornadoWarning(alert)) {
        if (isTornadoEmergency(alert)) return 'Tornado emergency — take cover immediately';
        if (isPdsTornado(alert) || isConfirmedTornado(alert)) {
            return 'Confirmed tornado — take cover now';
        }
        return 'Tornado warning — take cover now';
    }
    if (isFlashFloodEmergency(alert)) return 'Flash flood emergency — get to high ground now';
    if (/\bflash flood warning\b/i.test(alert.properties.event || ''))
        return 'Flash flood warning — move to high ground now';
    return 'Take shelter now';
}
