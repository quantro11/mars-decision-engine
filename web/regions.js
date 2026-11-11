// Named Mars regions used to label candidates and as demo bookmarks.
// lat / lon in degrees, lon east, -180..180. ez = proposed Exploration Zone at the
// 2015 NASA Human Landing Sites workshop (https://www.nasa.gov/mars-exploration-zones).
window.REGIONS = [
  { name: 'Jezero Crater (Perseverance)', lat: 18.4,  lon: 77.6,   ez: true,  mission: 'Mars 2020' },
  { name: 'Gale Crater (Curiosity)',      lat: -5.4,  lon: 137.8,  ez: true,  mission: 'MSL' },
  { name: 'Elysium Planitia (InSight)',   lat: 4.5,   lon: 135.6,  mission: 'InSight' },
  { name: 'Meridiani Planum (Opportunity)', lat: -1.9, lon: -5.5,  mission: 'MER-B' },
  { name: 'Gusev Crater (Spirit)',        lat: -14.6, lon: 175.5,  mission: 'MER-A' },
  { name: 'Chryse Planitia (Viking 1)',   lat: 22.3,  lon: -48.0,  mission: 'Viking 1' },
  { name: 'Utopia Planitia (Viking 2 / Zhurong)', lat: 46.7, lon: 117.5, mission: 'Viking 2' },
  { name: 'Ares Vallis (Pathfinder)',     lat: 19.1,  lon: -33.2,  mission: 'Pathfinder' },
  { name: 'Vastitas Borealis (Phoenix)',  lat: 68.2,  lon: -125.7, mission: 'Phoenix' },
  { name: 'Oxia Planum (ExoMars)',        lat: 18.3,  lon: -24.4,  mission: 'ExoMars' },
  { name: 'Arcadia Planitia',             lat: 46.0,  lon: -175.0, ez: false, note: 'SWIM shallow ice; crewed-mission favourite' },
  { name: 'Deuteronilus Mensae',          lat: 43.9,  lon: 23.9,   ez: true,  note: 'Glacial ice, HLS2015 EZ' },
  { name: 'Protonilus Mensae',            lat: 43.9,  lon: 49.5,   ez: true },
  { name: 'Phlegra Montes',               lat: 40.4,  lon: 163.7,  ez: true },
  { name: 'Erebus Montes',                lat: 35.0,  lon: -175.0, ez: true },
  { name: 'Hebrus Valles',                lat: 20.0,  lon: 126.5,  ez: true },
  { name: 'Nili Fossae',                  lat: 22.0,  lon: 77.0,   ez: true },
  { name: 'Mawrth Vallis',                lat: 22.3,  lon: -16.5,  ez: true },
  { name: 'Eberswalde Crater',            lat: -24.0, lon: -33.5,  ez: true },
  { name: 'Huygens Crater',               lat: -14.0, lon: 55.6,   ez: true },
  { name: 'Hellas Planitia floor',        lat: -42.4, lon: 70.5,   ez: true,  note: 'Lowest point, thickest atmosphere' },
  { name: 'Noctis Labyrinthus',           lat: -7.0,  lon: -102.0, ez: true },
  { name: 'Valles Marineris (Melas)',     lat: -10.0, lon: -72.0,  ez: true },
  { name: 'Isidis Planitia',              lat: 12.9,  lon: 87.0 },
  { name: 'Amazonis Planitia',            lat: 24.8,  lon: -164.0 },
  { name: 'Acidalia Planitia',            lat: 46.7,  lon: -22.0 },
  { name: 'Argyre Planitia',              lat: -49.7, lon: -43.0 },
  { name: 'Syrtis Major',                 lat: 8.4,   lon: 69.5 },
  { name: 'Olympus Mons',                 lat: 18.65, lon: -133.8 },
  { name: 'Tharsis Montes',               lat: 1.0,   lon: -112.0 },
  { name: 'Alba Mons',                    lat: 40.5,  lon: -109.6 },
  { name: 'Elysium Mons',                 lat: 25.0,  lon: 147.0 },
  { name: 'Lunae Planum',                 lat: 10.0,  lon: -65.0 },
  { name: 'Kasei Valles',                 lat: 24.0,  lon: -65.0 },
  { name: 'Tempe Terra',                  lat: 40.0,  lon: -70.0 },
  { name: 'Hesperia Planum',              lat: -21.0, lon: 110.0 },
  { name: 'Terra Cimmeria',               lat: -32.0, lon: 145.0 },
  { name: 'Terra Sabaea',                 lat: 2.0,   lon: 42.0 },
  { name: 'Noachis Terra',                lat: -45.0, lon: 10.0 },
  { name: 'Nilosyrtis Mensae',            lat: 36.0,  lon: 68.0 },
  { name: 'Cerberus Fossae',              lat: 10.0,  lon: 157.0 },
  { name: 'Lyot Crater',                  lat: 50.5,  lon: 29.3 },
  { name: 'Milankovič Crater',            lat: 54.7,  lon: -146.7 },
  { name: 'Schiaparelli Crater',          lat: -3.0,  lon: 16.7 },
  { name: 'Planum Boreum (N polar cap)',  lat: 88.0,  lon: 0.0 },
  { name: 'Planum Australe (S polar cap)', lat: -84.0, lon: 0.0 },
];

window.nearestRegion = function (lat, lon) {
  let best = null, bd = 1e9;
  for (const r of window.REGIONS) {
    let dlon = Math.abs(r.lon - lon); if (dlon > 180) dlon = 360 - dlon;
    const d = Math.hypot(r.lat - lat, dlon * Math.cos((lat * Math.PI) / 180));
    if (d < bd) { bd = d; best = r; }
  }
  return { region: best, distDeg: bd };
};
