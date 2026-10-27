// Compile the renderer with bundled Babel; no runtime compiler or extra install.
const fs = require('node:fs');
const path = require('node:path');
const babel = require('../vendor/babel.min.js');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'xpad.jsx'), 'utf8');
const result = babel.transform(source, { presets: ['react'], sourceType: 'script' });
fs.writeFileSync(path.join(root, 'xpad.js'), result.code + '\n');
console.log('Built xpad.js');
