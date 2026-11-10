Live source: the Met Office bucket `met-office-atmospheric-model-data`, `global-deterministic-10km/20261102T0000Z/`.

- `files.json`: the steps each run publishes (from a listing of the 00 and 06 UTC runs of 2026-11-02), the file names the model reads and the 37 pressure levels (Pa) of the pressure-level files.
- `grid.json`: dimensions and axes measured from `temperature_at_screen_level` (1920 x 2560). `latitude` runs -89.953125 to 89.953125 (cell centres, south to north) and `longitude` -179.929688 to 179.929688, so `lon1` is 180.0703125 in the 0 to 360 form. Spacing 179.90625 / 1919 = 0.09375 and 359.859375 / 2559 = 0.140625 degrees.
- `fog-fraction.nc`: the real `20261102T0300Z-PT0003H00M-fog_fraction_at_screen_level.nc` (552 KB), a whole file, for the offline reader test. Samples checked against h5py: [0,0] 0.0, [40,38] 0.5, [40,40] 0.75, [1919,2559] 0.25.

Source data: Met Office Global Deterministic 10 km (CC BY-SA 4.0).
