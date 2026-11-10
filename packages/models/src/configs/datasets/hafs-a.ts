import { defineHafs } from '../hafs.ts';

/** NOAA HAFS-A, the storm nest only. See `../hafs.ts`. */
export const hafsA = defineHafs('hfsa', 'hafs-a', 'HAFS-A');
