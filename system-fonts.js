const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

function parseFontFamilies(output) {
  return [...new Set(output.split(/[\n,]/).map(name => name.trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

async function listSystemFonts(execute = run) {
  try {
    // Fontconfig is optional: bundled Kalam and generic fonts always work.
    const { stdout } = await execute('fc-list', ['--format', '%{family}\n'], {
      encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 10000,
    });
    return { ok: true, families: parseFontFamilies(stdout) };
  } catch {
    return {
      ok: true, families: [],
      warning: 'System fonts could not be listed. Bundled Kalam and generic fonts are available.',
    };
  }
}
module.exports = { parseFontFamilies, listSystemFonts };
