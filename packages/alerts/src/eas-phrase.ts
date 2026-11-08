const EAS_ACTIVATION_PHRASE = /\bBULLETIN\s*-\s*EAS\s+ACTIVATION\s+REQUESTED\b/i;
export function hasEASActivationRequest(rawText: string): boolean {
    return EAS_ACTIVATION_PHRASE.test(rawText);
}
