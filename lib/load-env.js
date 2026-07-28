/**
 * Minimal zero-dependency .env loader.
 *
 * Reads KEY=VALUE lines from .env.local (then .env) in the current working
 * directory and, failing that, from bgit's own package directory — so a globally
 * installed `bgit` still finds a secret placed beside its install. Existing
 * process.env values always win (an explicit shell export overrides the file).
 * Values may be optionally quoted. Lines starting with # are comments.
 *
 * This exists so HANDCASH_APP_SECRET can live in .env.local (gitignored) instead
 * of being hardcoded in source. No dependency is added on purpose.
 */

const fs = require('fs');
const path = require('path');

function parseInto(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return; // no such file — fine
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue; // ignore non KEY=VALUE lines (e.g. a stray "KEY: 'x',")
    const key = line.slice(0, eq).trim();
    if (!key || key in process.env) continue; // don't clobber an explicit env var
    let val = line.slice(eq + 1).trim();
    // Strip a single trailing comma, then surrounding quotes.
    val = val.replace(/,$/, '');
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

function loadEnv() {
  const dirs = [process.cwd(), path.join(__dirname, '..')];
  for (const dir of dirs) {
    parseInto(path.join(dir, '.env.local'));
    parseInto(path.join(dir, '.env'));
  }
}

module.exports = { loadEnv };
