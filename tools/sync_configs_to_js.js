// Generate offline file:// UMD companions from single-source JSON config files.
// Run: node tools/sync_configs_to_js.js
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PAIRS = [
  { json: 'web/vehicles.json', js: 'web/vehicles_data.js', globalName: 'MDE_VEHICLES' },
  { json: 'web/tactical_config.json', js: 'web/tactical_config_data.js', globalName: 'MDE_TACTICAL_CONFIG' },
];

for (const p of PAIRS) {
  const srcPath = path.join(ROOT, p.json);
  const dstPath = path.join(ROOT, p.js);
  const obj = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
  const content =
    `// Auto-generated from ${p.json} — do not edit manually; run node tools/sync_configs_to_js.js\n` +
    `(function (global) {\n` +
    `  'use strict';\n` +
    `  var DATA = ${JSON.stringify(obj, null, 2)};\n` +
    `  if (typeof module !== 'undefined' && module.exports) module.exports = DATA;\n` +
    `  else global.${p.globalName} = DATA;\n` +
    `})(typeof window !== 'undefined' ? window : globalThis);\n`;
  fs.writeFileSync(dstPath, content, 'utf8');
  console.log(`Synced ${p.json} -> ${p.js}`);
}
