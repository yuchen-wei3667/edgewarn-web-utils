import { defineHafs } from '../hafs.ts';

/** NOAA HAFS-B, the storm nest only. See `../hafs.ts`. */
export const hafsB = defineHafs('hfsb', 'hafs-b', 'HAFS-B');
