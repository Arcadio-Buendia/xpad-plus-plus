const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

function parseFontFamilies(output) {
  return [...new Set(output.split(/[\n,]/).map(name => name.trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

async function listSystemFonts() {
  try {
    // Fontconfig includes system fonts, user fonts, and installed family aliases.
    const { stdout } = await run('fc-list', ['--format', '%{family}\n'], {
      encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 10000,
    });
    const families = parseFontFamilies(stdout);
    return families.length ? { ok: true, families } : { ok: false, families: [], error: 'No installed fonts were found.' };
  } catch (err) {
    return { ok: false, families: [], error: `Could not list system fonts: ${err.message}` };
  }
}
module.exports = { parseFontFamilies, listSystemFonts };
