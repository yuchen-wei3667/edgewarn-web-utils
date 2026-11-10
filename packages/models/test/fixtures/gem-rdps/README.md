Live source: Open-Meteo `data_spatial/cmc_gem_rdps_10km/2026/11/01/1200Z/`.

- `manifests.json`: original run metadata, including variable names, CRS and valid times.
- `grid.json`: dimensions measured from the OM `temperature_2m` child; spherical axes measured from the original ECCC temperature GRIB header. Open-Meteo preserves the rows and columns without resampling.
- `temperature-replay.json`: exact HTTP range responses for the +6 h `temperature_2m` full-grid read, captured through the existing `OmByteSource` and OM decoder. About 703 KB came over the network, from an object of about 65 MB. Sample values compare the same native cell indices against the ECCC GRIB payload (within 0.02 degrees C). For that numeric comparison only, template 3.1 was treated as 3.0 to unpack the unchanged scan-order values; no geographic coordinates were taken from that temporary header.

The decoder, worker tiles, missing-component errors and cache reuse are tested offline by `models-gem.test.mjs`. Source data: ECCC via Open-Meteo (CC BY 4.0).
