// Build without npm, using the bundled Babel and the system's GJS runtime.
// Run from the repository root: gjs scripts/build-xpad.js
const GLib = imports.gi.GLib;
const read = p => imports.byteArray.toString(GLib.file_get_contents(p)[1]);
(0, eval)(read('vendor/babel.min.js'));
const output = Babel.transform(read('xpad.jsx'), {presets:['react'], sourceType:'script'}).code;
GLib.file_set_contents('xpad.js', output + '\n');
print('Built xpad.js');
