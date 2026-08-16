/**
 * CommonJS → ESM bridge for the vendored on-chain format implementation.
 *
 * Our CLI is CommonJS; upstream (lib/chain/*.mjs) is ESM. Node can load ESM from
 * CJS only through dynamic import(), which is async — hence every accessor here
 * returns a promise. Modules are cached after first load.
 *
 * Upstream guards its CLI entry with an `import.meta.url === process.argv[1]`
 * check, so importing these modules never triggers their argument parsing.
 *
 * See lib/chain/UPSTREAM.md — do not edit the vendored files.
 */

const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const CHAIN_DIR = path.join(__dirname, 'chain');

/**
 * Upstream resolves @bsv/sdk by walking a list of candidate directories, the
 * first being process.env.BGIT_SDK_DIR. Point it at lib/ so resolution starts
 * inside this package and walks up to our node_modules — this keeps working when
 * bgit is installed globally, where cwd is the user's repo and has no @bsv/sdk.
 * An operator-set value wins; we only supply a default.
 */
if (!process.env.BGIT_SDK_DIR) {
  process.env.BGIT_SDK_DIR = __dirname;
}

const cache = new Map();

/**
 * Dynamically import one vendored ESM module.
 *
 * @param {string} name - File name, e.g. 'publisher.mjs'
 * @returns {Promise<object>} The module namespace
 */
async function loadChainModule(name) {
  if (cache.has(name)) return cache.get(name);

  const file = path.join(CHAIN_DIR, name);
  if (!fs.existsSync(file)) {
    throw new Error(
      `Vendored module missing: lib/chain/${name}\n` +
      `Restore it from https://github.com/zcoolz/bgit (see lib/chain/UPSTREAM.md).`
    );
  }

  let mod;
  try {
    // pathToFileURL matters on Windows, where a bare path is not a valid import specifier.
    mod = await import(pathToFileURL(file).href);
  } catch (error) {
    if (/@bsv\/sdk/.test(error.message)) {
      throw new Error(
        `The on-chain commands need @bsv/sdk, which could not be resolved.\n` +
        `Install dependencies with: pnpm install\n\n` +
        `Underlying error: ${error.message}`
      );
    }
    throw error;
  }

  cache.set(name, mod);
  return mod;
}

const publisher = () => loadChainModule('publisher.mjs');
const reader = () => loadChainModule('reader.mjs');
const claim = () => loadChainModule('claim.mjs');

/**
 * Verify the vendored sources still hash to the values recorded in UPSTREAM.md.
 *
 * These files implement a format written to a blockchain that can never be
 * patched after the fact, so silent drift is a correctness problem, not a style
 * one. Hashes are duplicated here deliberately: a check that reads its own
 * expectations out of the file it is checking proves nothing.
 *
 * @returns {{ok: boolean, results: Array<{file: string, expected: string, actual: string, ok: boolean}>}}
 */
function verifyVendor() {
  const { createHash } = require('crypto');

  const EXPECTED = {
    'publisher.mjs': '09cf2c8682c377af8bc264946e7d7176e701842b678ae0f793dabd10fdb3ef1e',
    'reader.mjs': '2a01adfdbceb4cfcba088b2b68a76855ebb5a45eefe5b7ef07b3d5997dcfcedd',
    'claim.mjs': '36b0989f69be987272726a345c9db25405bf5e12a551dd3830311671cb9cba31',
  };

  const results = Object.entries(EXPECTED).map(([file, expected]) => {
    const full = path.join(CHAIN_DIR, file);
    let actual = null;
    try {
      actual = createHash('sha256').update(fs.readFileSync(full)).digest('hex');
    } catch {
      actual = 'MISSING';
    }
    return { file, expected, actual, ok: actual === expected };
  });

  return { ok: results.every((r) => r.ok), results };
}

module.exports = {
  CHAIN_DIR,
  loadChainModule,
  publisher,
  reader,
  claim,
  verifyVendor,
};
