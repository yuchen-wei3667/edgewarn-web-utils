export type HazardType =
  | 'severe'
  | 'flood'
  | 'heat'
  | 'cold'
  | 'wind'
  | 'winter'
  | 'tropical'
  | 'fire';

export function hazardTypeForAlert(event: string): HazardType | null {
  const text = event.toLowerCase();
  // Only these NWS products belong in the severe-thunderstorm assessment.
  // In particular, do not let an otherwise-unclassified alert (for example,
  // Dense Fog Advisory) fall through to the severe bucket.
  if (/\b(?:severe thunderstorm|tornado)\b.*\b(?:watch|warning)\b/.test(text)
    || /\b(?:watch|warning)\b.*\b(?:severe thunderstorm|tornado)\b/.test(text)) return 'severe';
  if (/flood|flash|excessive rain|hydrolog/.test(text)) return 'flood';
  if (/heat|hot/.test(text)) return 'heat';
  if (/cold|freeze|frost|chill|ice/.test(text)) return 'cold';
  if (/wind|gust/.test(text)) return 'wind';
  if (/snow|winter|blizzard|sleet/.test(text)) return 'winter';
  if (/hurricane|tropical|typhoon|cyclone|storm surge/.test(text)) return 'tropical';
  if (/fire|smoke|red flag/.test(text)) return 'fire';
  return null;
}

