Live source: Open-Meteo `data_spatial/cmc_gem_hrdps/2026/11/02/1200Z/`.

- `manifests.json`: run metadata (variables, CRS, valid times) of the 12 UTC run.
- `grid.json`: dimensions measured from the OM `temperature_2m` child (1290 x 2540). The rotated axes and the pole come from the ECCC GRIB header of `20261102T12Z_MSC_HRDPS_TMP_AGL-2m_RLatLon0.0225_PT001H.grib2` (template 3.1: first point -12.302501, 345.17878; 0.0225 degrees; southern pole -36.08852, 245.305142). The Open-Meteo array was compared with the GRIB message value for value (3287 sampled cells, largest difference 0.03 degrees C); the same array flipped north to south did not agree.

Source data: ECCC via Open-Meteo (CC BY 4.0).
