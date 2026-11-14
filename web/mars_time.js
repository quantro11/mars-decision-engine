/* NASA GISS Mars24 / Allison & McEwen (2000) Planetary & Space Science 48:215-235 */
(function (root) {
  'use strict';

  var DEG2RAD = Math.PI / 180;
  var RAD2DEG = 180 / Math.PI;
  var OBLIQUITY_DEG = 25.1919; // Mars spin axis obliquity (Mars24 Technical Notes)
  var EPOCH_JD_TT = 2451545.0; // Reference epoch 2000-01-01 12:00 TT
  var JD_UNIX_EPOCH = 2440587.5; // 1970-01-01 00:00 UTC

  // IERS Bulletin C TAI-UTC leap second steps (JD_UT start, TAI-UTC seconds)
  // TT - UTC = (TAI - UTC) + 32.184 s
  var LEAP_STEPS = [
    [2441317.5, 10], [2441499.5, 11], [2441683.5, 12], [2442048.5, 13],
    [2442413.5, 14], [2442778.5, 15], [2443144.5, 16], [2443509.5, 17],
    [2443874.5, 18], [2444239.5, 19], [2444786.5, 20], [2445151.5, 21],
    [2445516.5, 22], [2446247.5, 23], [2447161.5, 24], [2447892.5, 25],
    [2448257.5, 26], [2448804.5, 27], [2449169.5, 28], [2449534.5, 29],
    [2450083.5, 30], [2450630.5, 31], [2451179.5, 32], [2453736.5, 33],
    [2454832.5, 34], [2456109.5, 35], [2457204.5, 36], [2457754.5, 37],
  ];

  // Mars24 7-term planetary perturbation series [A_deg, period_days, phase_deg]
  var PBS_TERMS = [
    [0.0071, 2.2353, 49.409],
    [0.0057, 2.7543, 168.173],
    [0.0039, 1.1177, 191.837],
    [0.0037, 15.7866, 21.736],
    [0.0021, 2.1354, 15.704],
    [0.0020, 2.4694, 95.528],
    [0.0018, 32.8493, 49.095],
  ];

  // Unwrapped Ls at epoch 2000-01-01 12:00 TT relative to Mars Year 1 vernal equinox
  // (1955-04-11, Ls = 0° per Clancy et al. 2000, JGR 105:9553).
  // Verified across MY 1 (1955-04-11) through MY 38+.
  var UNWRAPPED_LS_AT_MY1_START_DEG = -23 * 360;

  function mod(x, period) {
    return ((x % period) + period) % period;
  }

  function parseDateUtcMs(input) {
    if (input instanceof Date) return input.getTime();
    if (typeof input === 'number' && Number.isFinite(input)) return input;
    if (typeof input === 'string') {
      var trimmed = input.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        return Date.parse(trimmed + 'T12:00:00Z');
      }
      var parsed = Date.parse(trimmed);
      if (Number.isFinite(parsed)) return parsed;
    }
    return Date.now();
  }

  function julianDateUT(dateInput) {
    return JD_UNIX_EPOCH + parseDateUtcMs(dateInput) / 86400000;
  }

  function ttMinusUtcSeconds(jdUt) {
    if (jdUt >= LEAP_STEPS[0][0]) {
      var taiMinusUtc = 10;
      for (var i = 0; i < LEAP_STEPS.length; i++) {
        if (jdUt >= LEAP_STEPS[i][0]) taiMinusUtc = LEAP_STEPS[i][1];
      }
      return taiMinusUtc + 32.184;
    }
    // Mars24 polynomial formula for dates prior to 1972-01-01
    var T = (jdUt - EPOCH_JD_TT) / 36525;
    return 64.184 + 59 * T - 51.2 * T * T - 67.1 * T * T * T - 16.4 * T * T * T * T;
  }

  function seasonNameFromLs(lsDeg) {
    var ls = mod(lsDeg, 360);
    if (ls < 90) return 'N. Spring / S. Autumn';
    if (ls < 180) return 'N. Summer / S. Winter';
    if (ls < 270) return 'N. Autumn / S. Spring';
    return 'N. Winter / S. Summer';
  }

  function computeMarsTime(dateInput, lonEastDeg) {
    var lon = Number.isFinite(lonEastDeg) ? lonEastDeg : 0;
    var jdUt = julianDateUT(dateInput);
    var deltaTT = ttMinusUtcSeconds(jdUt);
    var jdTt = jdUt + deltaTT / 86400;
    var dt = jdTt - EPOCH_JD_TT;

    var mDeg = mod(19.3871 + 0.52402073 * dt, 360);
    var alphaFmsUnwrapped = 270.3871 + 0.524038496 * dt;
    var alphaFmsDeg = mod(alphaFmsUnwrapped, 360);

    var pbsDeg = 0;
    for (var i = 0; i < PBS_TERMS.length; i++) {
      var t = PBS_TERMS[i];
      pbsDeg += t[0] * Math.cos((0.985626 * dt / t[1] + t[2]) * DEG2RAD);
    }

    var mRad = mDeg * DEG2RAD;
    var vMinusMDeg =
      (10.691 + 3.0e-7 * dt) * Math.sin(mRad) +
      0.623 * Math.sin(2 * mRad) +
      0.050 * Math.sin(3 * mRad) +
      0.005 * Math.sin(4 * mRad) +
      0.0005 * Math.sin(5 * mRad) +
      pbsDeg;

    var unwrappedLs = alphaFmsUnwrapped + vMinusMDeg;
    var lsDeg = mod(unwrappedLs, 360);
    // Mars Year (Clancy et al. 2000): strictly monotonic via unwrappedLs
    var marsYear = 1 + Math.floor((unwrappedLs - UNWRAPPED_LS_AT_MY1_START_DEG) / 360);

    var lsRad = lsDeg * DEG2RAD;
    var eotDeg =
      2.861 * Math.sin(2 * lsRad) -
      0.071 * Math.sin(4 * lsRad) +
      0.002 * Math.sin(6 * lsRad) -
      vMinusMDeg;
    var eotHours = eotDeg / 15;

    var msd = (jdTt - 2451549.5) / 1.0274912517 + 44796.0 - 0.0009626;
    var mtcHours = mod(24 * msd, 24);
    var lmstHours = mod(mtcHours + lon / 15, 24);
    var ltstHours = mod(lmstHours + eotHours, 24);
    var solarDeclinationDeg = Math.asin(Math.sin(OBLIQUITY_DEG * DEG2RAD) * Math.sin(lsRad)) * RAD2DEG;

    return {
      jdUt: jdUt,
      jdTt: jdTt,
      dt: dt,
      ttMinusUtcSec: deltaTT,
      meanAnomalyDeg: mDeg,
      alphaFmsDeg: alphaFmsDeg,
      pbsDeg: pbsDeg,
      vMinusMDeg: vMinusMDeg,
      lsDeg: lsDeg,
      marsYear: marsYear,
      seasonName: seasonNameFromLs(lsDeg),
      eotDeg: eotDeg,
      eotHours: eotHours,
      solarDeclinationDeg: solarDeclinationDeg,
      msd: msd,
      mtcHours: mtcHours,
      lmstHours: lmstHours,
      ltstHours: ltstHours,
      source: 'Allison & McEwen (2000) / NASA GISS Mars24 Algorithm (updated 2025-01-07)',
      badge: 'MODEL',
    };
  }

  function solarZenithCos(latDeg, lsDeg, ltstHours) {
    var decl = Math.asin(Math.sin(OBLIQUITY_DEG * DEG2RAD) * Math.sin(lsDeg * DEG2RAD));
    var lat = latDeg * DEG2RAD;
    var ha = (ltstHours - 12) * 15 * DEG2RAD;
    return Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  }

  var api = {
    OBLIQUITY_DEG: OBLIQUITY_DEG,
    parseDateUtcMs: parseDateUtcMs,
    julianDateUT: julianDateUT,
    ttMinusUtcSeconds: ttMinusUtcSeconds,
    seasonNameFromLs: seasonNameFromLs,
    computeMarsTime: computeMarsTime,
    solarZenithCos: solarZenithCos,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.MDE_MARS_TIME = api;
})(typeof window !== 'undefined' ? window : globalThis);
