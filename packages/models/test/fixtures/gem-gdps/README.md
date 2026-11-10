Live sources: Open-Meteo `data_spatial/cmc_gem_gdps_15km/2026/11/01/1200Z/` (surface) and `cmc_gem_gdps_15km_upper_level/2026/11/01/1200Z/` (pressure).

`manifests.json` saves both original run manifests, including CRS, variable names and valid times. Surface fields are hourly through 84 h, then three-hourly to 240 h; pressure fields are three-hourly throughout.

`grid.json` records the 1201 x 2400 dimensions measured from the OM array and the 0.15-degree global grid. Open-Meteo shifts ECCC's original 0-to-360 columns to -180-to-180, with rows still south to north. Live full-grid smoke checks covered temperature, MSLP, 10 m wind speed/direction and 500 mb temperature. Source data: ECCC via Open-Meteo (CC BY 4.0).
