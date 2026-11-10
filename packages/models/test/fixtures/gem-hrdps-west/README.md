Live source: Open-Meteo `data_spatial/cmc_gem_hrdps_west/2026/11/02/1200Z/`.

- `manifests.json`: run metadata of the 12 UTC run (21 variables, no pressure levels).
- `grid.json`: dimensions measured from the OM `temperature_2m` child (1180 x 1330). ECCC no longer lists this domain on its public datamart, so there is no GRIB header to read. The rotation is the HRDPS one in the form Open-Meteo states (its WKT: pole latitude -33.443382, central meridian 86.46358, i.e. southern pole longitude 266.46358, the same convention that reproduces the HRDPS Continental grid and RDPS). The first point and spacing follow from the stated south-west (45.92686, -126.25641) and north-east (60.2894, -114.45587) corners: 0.00899 degrees in both directions (the two derived spacings agree to seven digits). Open-Meteo's 2 m temperature was compared with HRDPS Continental's on the shared cells (mean absolute difference 0.8 degrees C); moving the corner by 0.2 degrees doubled it.

Source data: ECCC via Open-Meteo (CC BY 4.0).
