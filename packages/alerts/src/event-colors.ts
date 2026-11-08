// NWS Severity Colors (fallback)
const SEVERITY_COLORS: Record<string, { bg: string; border: string; dot: string }> = {
    Extreme: { bg: '#7c2d12', border: '#ea580c', dot: '#f97316' },
    Severe: { bg: '#7f1d1d', border: '#dc2626', dot: '#ef4444' },
    Moderate: { bg: '#78350f', border: '#d97706', dot: '#f59e0b' },
    Minor: { bg: '#1e3a5f', border: '#3b82f6', dot: '#60a5fa' },
    Unknown: { bg: '#374151', border: '#6b7280', dot: '#9ca3af' },
};

/**
 * Per-event NWS alert colors using standard NWS VTEC color codes.
 * Each event type gets a unique color for clear visual distinction.
 * Format: { bg: dark popup bg, border: polygon outline, dot: polygon fill }
 */
const EVENT_COLORS: Record<string, { bg: string; border: string; dot: string }> = {
    // ── Warnings ──────────────────────────────────────────────────────────
    'Tornado Warning': { bg: '#450a0a', border: '#FF0000', dot: '#FF0000' },
    'Severe Thunderstorm Warning': { bg: '#451a03', border: '#FFA500', dot: '#FFA500' },
    'Flash Flood Warning': { bg: '#3b0000', border: '#8B0000', dot: '#8B0000' },
    'Flood Warning': { bg: '#003300', border: '#00FF00', dot: '#00FF00' },
    'Blizzard Warning': { bg: '#450a0a', border: '#FF0000', dot: '#FFFFFF' }, // Red border, White fill (Snow)
    'Winter Storm Warning': { bg: '#4a0a2a', border: '#FF69B4', dot: '#FF69B4' },
    'Snow Squall Warning': { bg: '#4a0a2a', border: '#C71585', dot: '#C71585' },
    'High Wind Warning': { bg: '#3d2f00', border: '#DAA520', dot: '#DAA520' },
    'Extreme Wind Warning': { bg: '#3d2200', border: '#FF8C00', dot: '#FF8C00' },
    'Hurricane Warning': { bg: '#3b0015', border: '#DC143C', dot: '#DC143C' },
    'Tropical Storm Warning': { bg: '#3b1010', border: '#B22222', dot: '#B22222' },
    'Typhoon Warning': { bg: '#3b0015', border: '#DC143C', dot: '#DC143C' },
    'Storm Surge Warning': { bg: '#2a0a3d', border: '#B524F7', dot: '#B524F7' },
    'Coastal Flood Warning': { bg: '#0a2b0a', border: '#228B22', dot: '#228B22' },
    'Tsunami Warning': { bg: '#3d1500', border: '#FD6347', dot: '#FD6347' },
    'Avalanche Warning': { bg: '#0a1e3d', border: '#1E90FF', dot: '#1E90FF' },
    'Dust Storm Warning': { bg: '#3d3300', border: '#FFD700', dot: '#FFD700' },
    'Volcano Warning': { bg: '#1a2626', border: '#2F4F4F', dot: '#556B5F' },
    'Red Flag Warning': { bg: '#3d0030', border: '#FF1493', dot: '#FF1493' },
    'Gale Warning': { bg: '#2a1a2a', border: '#DDA0DD', dot: '#DDA0DD' },
    'Storm Warning': { bg: '#2a0a3d', border: '#9400D3', dot: '#9400D3' },
    'Hurricane Force Wind Warning': { bg: '#2a1515', border: '#CD5C5C', dot: '#CD5C5C' },
    'Hard Freeze Warning': { bg: '#1a003d', border: '#9400D3', dot: '#BF40BF' },
    'Hazardous Seas Warning': { bg: '#2a2630', border: '#D8BFD8', dot: '#D8BFD8' },
    'Heavy Freezing Spray Warning': { bg: '#003040', border: '#00BFFF', dot: '#00BFFF' },
    'Special Marine Warning': { bg: '#451a03', border: '#FFA500', dot: '#FFA500' },
    'Extreme Cold Warning': { bg: '#00002a', border: '#0000FF', dot: '#4169E1' },
    'Fire Warning': { bg: '#3d0a0a', border: '#B22222', dot: '#E25822' },
    'Freeze Warning': { bg: '#0a0a3d', border: '#483D8B', dot: '#6A5ACD' },

    // ── Watches ───────────────────────────────────────────────────────────
    'Tornado Watch': { bg: '#3d3d00', border: '#FFFF00', dot: '#FFFF00' },
    'Severe Thunderstorm Watch': { bg: '#3d1a2a', border: '#DB7093', dot: '#DB7093' },
    'Flash Flood Watch': { bg: '#0a2a1e', border: '#2E8B57', dot: '#2E8B57' },
    'Flood Watch': { bg: '#0a2a1e', border: '#2E8B57', dot: '#3CB371' },
    'Winter Storm Watch': { bg: '#0f1e30', border: '#4682B4', dot: '#4682B4' },
    'Hurricane Watch': { bg: '#3d003d', border: '#FF00FF', dot: '#FF00FF' },
    'Tropical Storm Watch': { bg: '#3d2020', border: '#F08080', dot: '#F08080' },
    'Typhoon Watch': { bg: '#300030', border: '#CC33CC', dot: '#CC33CC' },
    'Storm Surge Watch': { bg: '#2a1a3d', border: '#DB7FF7', dot: '#DB7FF7' },
    'Coastal Flood Watch': { bg: '#1a3026', border: '#66CDAA', dot: '#66CDAA' },
    'Tsunami Watch': { bg: '#3d003d', border: '#FF00FF', dot: '#EE82EE' },
    'Avalanche Watch': { bg: '#302010', border: '#F4A460', dot: '#F4A460' },
    'High Wind Watch': { bg: '#2a2200', border: '#B8860B', dot: '#B8860B' },
    'Gale Watch': { bg: '#2a1a2a', border: '#FFC0CB', dot: '#FFC0CB' },
    'Storm Watch': { bg: '#2a2020', border: '#FFE4B5', dot: '#FFE4B5' },
    'Hurricane Force Wind Watch': { bg: '#1e0a30', border: '#9932CC', dot: '#9932CC' },
    'Hard Freeze Watch': { bg: '#0a1530', border: '#4169E1', dot: '#4169E1' },
    'Hazardous Seas Watch': { bg: '#0f0f2a', border: '#483D8B', dot: '#7B68EE' },
    'Heavy Freezing Spray Watch': { bg: '#2a2020', border: '#BC8F8F', dot: '#BC8F8F' },
    'Extreme Cold Watch': { bg: '#00002a', border: '#0000FF', dot: '#0000FF' },
    'Extreme Heat Watch': { bg: '#2a0000', border: '#800000', dot: '#A52A2A' },
    'Freeze Watch': { bg: '#003030', border: '#00CED1', dot: '#00CED1' },

    // ── Advisories ────────────────────────────────────────────────────────
    'Dense Fog Advisory': { bg: '#1e2226', border: '#708090', dot: '#708090' },
    'Freezing Fog Advisory': { bg: '#002020', border: '#008080', dot: '#20B2AA' },
    'Dense Smoke Advisory': { bg: '#2a2a1a', border: '#F0E68C', dot: '#F0E68C' },
    'Ashfall Advisory': { bg: '#1e1e1e', border: '#696969', dot: '#808080' },
    'Blowing Dust Advisory': { bg: '#2a261a', border: '#BDB76B', dot: '#BDB76B' },
    'Dust Advisory': { bg: '#2a261a', border: '#BDB76B', dot: '#D2B48C' },
    'Frost Advisory': { bg: '#162040', border: '#6495ED', dot: '#6495ED' },
    'Heat Advisory': { bg: '#301a0a', border: '#FF7F50', dot: '#FF7F50' },
    'Wind Advisory': { bg: '#2a2415', border: '#D2B48C', dot: '#D2B48C' },
    'Lake Wind Advisory': { bg: '#2a2415', border: '#D2B48C', dot: '#DEB887' },
    'Lakeshore Flood Advisory': { bg: '#1a3000', border: '#7CFC00', dot: '#7CFC00' },
    'Winter Weather Advisory': { bg: '#1a1a30', border: '#7B68EE', dot: '#7B68EE' },
    'Small Craft Advisory': { bg: '#2a2415', border: '#D8BFD8', dot: '#D8BFD8' },
    'Small Craft Advisory for Hazardous Seas': { bg: '#2a2415', border: '#D8BFD8', dot: '#E0C8E0' },
    'Small Craft Advisory for Rough Bar': { bg: '#2a2415', border: '#D8BFD8', dot: '#D0B0D0' },
    'Small Craft Advisory for Winds': { bg: '#2a2415', border: '#D8BFD8', dot: '#C8A8C8' },
    'High Surf Warning': { bg: '#0a2b0a', border: '#228B22', dot: '#32CD32' },

    // ── Statements ────────────────────────────────────────────────────────
    'Severe Weather Statement': { bg: '#003030', border: '#00FFFF', dot: '#00FFFF' },
    'Special Weather Statement': { bg: '#302a1a', border: '#FFE4B5', dot: '#FFE4B5' },
    'Marine Weather Statement': { bg: '#302820', border: '#FFDAB9', dot: '#FFDAB9' },
    'Tropical Cyclone Statement': { bg: '#3b1010', border: '#B22222', dot: '#CD5C5C' },
    'Tsunami Advisory': { bg: '#261500', border: '#D2691E', dot: '#D2691E' },
    'Hurricane Statement': { bg: '#3b0015', border: '#DC143C', dot: '#FF6B81' },
};

/**
 * Get color scheme for NWS alerts based on event type and severity.
 * Uses per-event lookup first, then falls back to severity colors.
 */
export const getEventColors = (event: string, severity: string) => {
    // Exact match first
    if (EVENT_COLORS[event]) {
        return EVENT_COLORS[event];
    }

    // Fallback to severity
    return SEVERITY_COLORS[severity] || SEVERITY_COLORS['Unknown'];
};
