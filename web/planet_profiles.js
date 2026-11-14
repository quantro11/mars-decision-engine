// Planetary constants used by the scoring, storm/power and tactical engines.
// One profile object per body so the same engines can be re-pointed at another world
// (Earth disaster-response siting, lunar EZ planning) by swapping PLANET_PROFILES.active.
// Only the Mars profile is verified. Earth and Moon are templates: null = not yet sourced.
(function (global) {
  'use strict';

  const MARS = {
    id: 'mars',
    name: 'Mars',
    verified: true,
    gravityMs2: { value: 3.71, source: 'NASA Mars Fact Sheet (GSFC): surface gravity 3.71 m/s^2 (0.378 g)' },
    radiusKm: { value: 3389.5, source: 'IAU 2000 mean radius, MOLA datum (Seidelmann et al. 2002)' },
    solHours: { value: 24.66, source: 'Mean solar day 24 h 39 m 35 s (Allison & McEwen 2000)' },
    solsPerYear: { value: 668.6, source: 'Allison & McEwen (2000): 668.59 sols per Mars year' },
    obliquityDeg: { value: 25.19, source: 'NASA Mars Fact Sheet: obliquity to orbit 25.19 deg' },
    eccentricity: { value: 0.0934, source: 'NASA Mars Fact Sheet: orbital eccentricity 0.0934' },
    lsPerihelionDeg: { value: 251.0, source: 'Perihelion at Ls ~251 deg (southern spring); Allison & McEwen 2000' },
    solarConstantWm2: { value: 586, source: 'Mean top-of-atmosphere irradiance at 1.524 AU (Appelbaum & Flood 1990)' },
    atmosphere: {
      columnDatumGcm2: { value: 16.4, source: '610 Pa datum / g = 3.71 m/s^2 -> 16.4 g/cm^2 column mass at MOLA areoid' },
      scaleHeightM: { value: 11100, source: 'Mean atmospheric scale height ~11.1 km (Zurek 1992; MCD v5)' },
      pressurePaPerGcm2: { value: 37.2076, source: 'P = sigma * g, with g expressed per g/cm^2 column (10 * 3.72076 m/s^2 at datum latitude)' },
      // Seasonal CO2 condensation / sublimation column cycle (two-harmonic fit to Viking/REMS pressure records)
      seasonalColumn: { phaseLsDeg: 255, a1: 0.092, a2: 0.038, source: 'Two-harmonic fit to Viking Lander 1/2 + MSL REMS annual pressure cycle (Tillman 1988; Haberle et al. 2014), +-12% amplitude' },
    },
    radiation: {
      anchorDoseMsvPerDay: { value: 0.64, source: 'Hassler et al. 2014, Science 343: MSL/RAD surface GCR 0.64 +- 0.12 mSv/day at Gale (-4.4 km)' },
      anchorColumnGcm2: { value: 24.6, source: 'Column mass above Gale Crater floor during RAD reference period (Hassler et al. 2014)' },
      eFoldColumnGcm2: { value: 60, source: 'Approximate e-folding of GCR dose with shielding column in the 15-30 g/cm^2 regime (Guo et al. 2015)' },
      anchorElevationM: { value: -4400, source: 'Bradbury Landing, Gale Crater (-4.59N, 137.44E) elevation ~ -4.4 km (MOLA)' },
    },
  };

  const TEMPLATE = (id, name) => ({
    id, name, verified: false,
    gravityMs2: { value: null, source: 'unverified - fill from fact sheet' },
    radiusKm: { value: null, source: 'unverified' },
    solHours: { value: null, source: 'unverified' },
    solsPerYear: { value: null, source: 'unverified' },
    obliquityDeg: { value: null, source: 'unverified' },
    eccentricity: { value: null, source: 'unverified' },
    lsPerihelionDeg: { value: null, source: 'unverified' },
    solarConstantWm2: { value: null, source: 'unverified' },
    atmosphere: { columnDatumGcm2: { value: null, source: 'unverified' }, scaleHeightM: { value: null, source: 'unverified' }, pressurePaPerGcm2: { value: null, source: 'unverified' }, seasonalColumn: { phaseLsDeg: null, a1: null, a2: null, source: 'unverified' } },
    radiation: { anchorDoseMsvPerDay: { value: null, source: 'unverified' }, anchorColumnGcm2: { value: null, source: 'unverified' }, eFoldColumnGcm2: { value: null, source: 'unverified' }, anchorElevationM: { value: null, source: 'unverified' } },
  });

  const PLANET_PROFILES = {
    mars: MARS,
    earth: TEMPLATE('earth', 'Earth (disaster-response template)'),
    moon: TEMPLATE('moon', 'Moon (Artemis EZ template)'),
    active: MARS,
    /** Return the active profile, or a named one. Engines call this once at load. */
    get(id) { return (id && this[id]) || this.active; },
  };

  global.PLANET_PROFILES = PLANET_PROFILES;
})(typeof module === 'object' && module.exports ? module.exports : globalThis);
