/** Product ids and station records shared by the NEXRAD tables. */
export type NexradProduct = 'DBZH' | 'VRADH' | 'WRADH' | 'PHIDP' | 'RHOHV' | 'ZDR';

export interface NexradSite {
    id: string;
    name: string;
    lat: number;
    lon: number;
    elevationMeters?: number;
    stationType?: string;
    network?: string;
}
