// Placeholder: no dust climatology bundled yet. Generate the real file with
//   python data_pipeline/build_dust_climatology.py <folder with Montabone CDOD NetCDF files>
// While this is null the app falls back to its built-in heuristic storm-season regions and a default haze of tau 0.5.
(function (global) { global.MDE_DUST_CLIM = null; })(typeof window !== 'undefined' ? window : module.exports);
