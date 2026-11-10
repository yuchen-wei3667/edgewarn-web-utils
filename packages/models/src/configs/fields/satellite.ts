import { defineField, type ModelSelector } from '../types.ts';
import { K_TO_C, sat, sfc } from './selectors.ts';

/**
 * Simulated GOES ABI brightness temperature, as HAFS writes it. The idx names no parameter, only
 * `parmcat=192 parm=N`, and N is 45 plus the ABI band (measured: bands 8 to 10 read like the
 * water-vapor channels, band 13 like the clean window). The grid outside the satellite's footprint is
 * filled with 9999 K, which `validMax` turns into missing.
 */
const NO_DATA_ABOVE_C = 100;
const abiBand = (band: number) => `var discipline=3 center=7 local_table=1 parmcat=192 parm=${45 + band}`;

const brightnessTemp = (selector: ModelSelector, id: string, label: string, colormap: string) =>
    defineField({
        id,
        label,
        pane: 'satellite',
        kind: 'scalar',
        units: '°C',
        quantity: 'temperature',
        inputs: [{ ...selector, transform: K_TO_C, validMax: NO_DATA_ABOVE_C }],
        colormap: { name: colormap, toStored: K_TO_C },
    });

export const HAFS_SAT_IR = brightnessTemp(
    sat(abiBand(13), 'top of atmosphere'),
    'HAFS_SAT_IR',
    'Simulated IR (10.3 µm)',
    'GOES_IR',
);
export const HAFS_SAT_WV_UPPER = brightnessTemp(
    sat(abiBand(8), 'top of atmosphere'),
    'HAFS_SAT_WV_UPPER',
    'Simulated Upper Water Vapor (6.2 µm)',
    'GOES_ABI_C08_BrightnessTemp',
);
export const HAFS_SAT_WV_MID = brightnessTemp(
    sat(abiBand(9), 'top of atmosphere'),
    'HAFS_SAT_WV_MID',
    'Simulated Mid Water Vapor (6.9 µm)',
    'GOES_ABI_C09_BrightnessTemp',
);
export const HAFS_SAT_WV_LOWER = brightnessTemp(
    sat(abiBand(10), 'top of atmosphere'),
    'HAFS_SAT_WV_LOWER',
    'Simulated Lower Water Vapor (7.3 µm)',
    'GOES_ABI_C10_BrightnessTemp',
);

/** HRRR publishes GOES-11/12 imager channels, rather than ABI channels. */
export const HRRR_SATELLITE_FIELDS = [
    brightnessTemp(
        sfc('SBT113', 'top of atmosphere'),
        'HRRR_SAT_GOES11_WV',
        'Simulated GOES-11 Water Vapor (6.7 µm)',
        'GOES_ABI_C09_BrightnessTemp',
    ),
    brightnessTemp(
        sfc('SBT114', 'top of atmosphere'),
        'HRRR_SAT_GOES11_IR',
        'Simulated GOES-11 IR (10.7 µm)',
        'GOES_IR',
    ),
    brightnessTemp(
        sfc('SBT123', 'top of atmosphere'),
        'HRRR_SAT_GOES12_WV',
        'Simulated GOES-12 Water Vapor (6.5 µm)',
        'GOES_ABI_C09_BrightnessTemp',
    ),
    brightnessTemp(
        sfc('SBT124', 'top of atmosphere'),
        'HRRR_SAT_GOES12_IR',
        'Simulated GOES-12 IR (10.7 µm)',
        'GOES_IR',
    ),
];

/** RRFS carries the ten thermal GOES-16 ABI bands in its surface object. */
export const RRFS_SATELLITE_FIELDS = (
    [
        [7, 'Shortwave IR (3.9 µm)'],
        [8, 'Upper Water Vapor (6.2 µm)'],
        [9, 'Mid Water Vapor (6.9 µm)'],
        [10, 'Lower Water Vapor (7.3 µm)'],
        [11, 'Cloud-Top Phase (8.4 µm)'],
        [12, 'Ozone (9.6 µm)'],
        [13, 'Clean IR (10.3 µm)'],
        [14, 'IR (11.2 µm)'],
        [15, 'Dirty IR (12.3 µm)'],
        [16, 'CO₂ (13.3 µm)'],
    ] as const
).map(([band, label]) =>
    brightnessTemp(
        sfc(`SBTA16${band}`, 'top of atmosphere'),
        `RRFS_SAT_ABI_C${String(band).padStart(2, '0')}`,
        `Simulated ABI Band ${band}: ${label}`,
        [13, 14, 15].includes(band) ? 'GOES_IR' : `GOES_ABI_C${String(band).padStart(2, '0')}_BrightnessTemp`,
    ),
);
