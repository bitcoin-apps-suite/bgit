/**
 * On-chain repository commands: publish, reconstruct, claim.
 *
 * These wrap the vendored implementation in lib/chain/ (see lib/chain/UPSTREAM.md)
 * and add the integration bgit contributes on top:
 *
 *   - auto-bundling      `git bundle create --all` from the current repo
 *   - auto-funding       size the UTXO from a real dry run, then select one
 *   - auto-bridging      a loopback broadcast bridge, so no external endpoint is needed
 *   - safety gate        always dry-run first, show the cost, confirm before spending
 *
 * Every upstream flag remains available and always wins over our inference, so
 * anything documented upstream works here unchanged.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');
const chalk = require('chalk');

const { publisher, reader, claim, verifyVendor } = require('./chain-bridge');
const { resolveKey, generateKey, selectFunding, DEFAULT_KEY_ENV, WHATSONCHAIN_API } = require('./funding');
const { startBridge } = require('./bridge-server');

/**
 * Upstream ships no default status source, by design. We default to a public
 * read-only endpoint for ergonomics but print it, so it is never a silent
 * choice, and `--status-url` overrides it.
 */
const DEFAULT_STATUS_URL = `${WHATSONCHAIN_API}/tx/hash/{txid}`;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Flags taking no value. */
const BOOL_FLAGS = new Set([
  'broadcast', 'continue', 'confirm', 'quiet', 'yes', 'json', 'keep-bundle',
]);

/**
 * Flags taking a value. Everything upstream accepts, plus our own additions.
 *
 * This is an allowlist rather than "anything starting with --" on purpose.
 * These commands spend money, and silently swallowing an unrecognised flag
 * means a typo like `--boradcast` changes what happens with no warning. An
 * unknown flag must stop the command, not be quietly ignored.
 */
const VALUE_FLAGS = new Set([
  // upstream publisher
  'bundle', 'repo', 'key', 'key-file', 'part-bytes', 'local-out', 'source-hint',
  'spec-txid', 'label', 'published-at', 'funding', 'bridge', 'state', 'repo-id',
  'chain-in', 'history-url', 'tx-url', 'source', 'role', 'status-url',
  // upstream reader
  'local-in', 'out', 'report',
  // upstream claim
  'domain',
  // ours
  'key-env',
]);

/** Parse `--flag value` / `--bool` pairs, collecting repeats of --bridge. */
function parseFlags(argv) {
  const out = { bridges: [] };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    // Chain commands are entirely flag-driven. A bare word is a mistake —
    // silently dropping it would let `bgit publish myrepo` look like it
    // honoured an argument it ignored.
    if (!arg.startsWith('--')) {
      throw new Error(
        `unexpected argument: ${arg}\n` +
        `Chain commands take flags only, e.g. --repo ${arg}`
      );
    }

    const name = arg.slice(2);
    const camel = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

    if (BOOL_FLAGS.has(name)) { out[camel] = true; continue; }

    if (!VALUE_FLAGS.has(name)) {
      throw new Error(
        `unknown flag: --${name}\n` +
        `Run \`bgit\` with no arguments to see the available commands and flags.`
      );
    }

    const value = argv[++i];
    if (value === undefined) throw new Error(`missing value for --${name}`);
    if (name === 'bridge') out.bridges.push(value);
    else out[camel] = value;
  }
  return out;
}

function inRepo() {
  try {
    execSync('git rev-parse --is-inside-work-tree', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/** Infer `owner/name` from the origin remote, for the --repo label. */
function inferRepoName() {
  try {
    const url = execSync('git remote get-url origin', { stdio: 'pipe' }).toString().trim();
    const match = /[/:]([^/:]+\/[^/]+?)(?:\.git)?$/.exec(url);
    if (match) return match[1];
  } catch { /* no origin: fall through to directory name */ }
  try {
    const top = execSync('git rev-parse --show-toplevel', { stdio: 'pipe' }).toString().trim();
    return path.basename(top);
  } catch {
    return null;
  }
}

/**
 * Credit line shown on every on-chain command.
 *
 * The format these commands run is Ryan Bennett's, vendored unmodified. Anyone
 * who only ever touches the CLI should still learn whose work it is, so this is
 * printed by the commands themselves rather than left to the README.
 */
function showChainCredit() {
  console.log(
    chalk.gray('on-chain format by ') +
    chalk.cyan('Ryan Bennett (@zcoolz)') +
    chalk.gray(' — github.com/zcoolz/bgit · MIT · vendored unmodified')
  );
}

function formatSats(sats) {
  const bsv = sats / 1e8;
  return `${sats.toLocaleString()} sats (${bsv.toFixed(8)} BSV)`;
}

async function confirmPrompt(question) {
  if (!process.stdin.isTTY) {
    throw new Error('Refusing to broadcast without confirmation on a non-interactive stream. Pass --yes to proceed.');
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(question, resolve));
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

/** Apply source defaults so the reader works with no flags at all. */
function withSourceDefaults(opts) {
  const next = { ...opts };
  if (!next.source && !next.historyUrl && !next.txUrl && !next.localIn && !next.chainIn) {
    next.source = 'woc';
  }
  return next;
}

// ---------------------------------------------------------------------------
// bgit publish
// ---------------------------------------------------------------------------

async function publishCommand(argv) {
  const flags = parseFlags(argv);
  const { runPublisher, runConfirm } = await publisher();

  // --confirm is a separate pass: the only one allowed to report acceptance.
  if (flags.confirm) {
    const statusUrl = flags.statusUrl || DEFAULT_STATUS_URL;
    if (!flags.statusUrl) console.log(chalk.gray(`status source: ${statusUrl}\n`));
    await runConfirm({ ...flags, statusUrl });
    return 0;
  }

  if (!inRepo() && !flags.bundle) {
    console.error(chalk.red('Not inside a git repository, and no --bundle given.'));
    return 1;
  }

  // ---- 1. bundle ----------------------------------------------------------
  let bundlePath = flags.bundle;
  let tempDir = null;

  if (!bundlePath) {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgit-publish-'));
    bundlePath = path.join(tempDir, 'repo.bundle');
    console.log(chalk.blue('Bundling repository history...'));
    try {
      execSync(`git bundle create ${JSON.stringify(bundlePath)} --all`, { stdio: 'pipe' });
    } catch (error) {
      const detail = (error.stderr && error.stderr.toString().trim()) || error.message;
      console.error(chalk.red(`git bundle failed: ${detail}`));
      return 1;
    }
    const mb = fs.statSync(bundlePath).size / 1e6;
    console.log(chalk.green(`✓ bundle: ${mb.toFixed(2)} MB\n`));
  }

  const repo = flags.repo || inferRepoName();
  if (!repo) {
    console.error(chalk.red('Could not infer a repository name. Pass --repo <owner/name>.'));
    return 1;
  }

  // ---- 2. key -------------------------------------------------------------
  let key;
  try {
    key = resolveKey(flags);
  } catch (error) {
    console.error(chalk.red(error.message));
    return 1;
  }
  console.log(chalk.gray(`repo:      ${repo}`));
  console.log(chalk.gray(`publisher: ${key.address}  (from ${key.source})\n`));

  /**
   * Where the publisher writes its transaction fixture and publish-state.json.
   *
   * This MUST outlive the command when broadcasting. publish-state.json is the
   * only record of which txids were sent, and `--confirm` — the sole pass
   * allowed to report mined acceptance — reads it. Defaulting it inside the
   * temp bundle dir meant cleanup deleted it on the way out: money spent,
   * transactions live, and no way to confirm them.
   *
   * So a broadcast always writes somewhere persistent. A dry run has nothing
   * worth keeping, so it stays in the temp dir and is cleaned up.
   */
  const outDir = flags.localOut || (
    flags.broadcast
      ? path.join(process.cwd(), 'bgit-publish')
      : path.join(tempDir || process.cwd(), 'bgit-publish')
  );

  // Upstream reads the WIF from opts.key in-process, so the secret never
  // reaches disk or a child process argv.
  const baseOpts = {
    ...flags,
    bundle: bundlePath,
    repo,
    key: key.wif,
    keyFile: undefined,
    localOut: outDir,
  };

  const cleanup = () => {
    if (!tempDir) return;
    // Never remove the temp dir while the publish output lives inside it —
    // that is how publish-state.json used to get destroyed after a broadcast.
    if (path.resolve(outDir).startsWith(path.resolve(tempDir) + path.sep)) {
      if (flags.broadcast) return;
    }
    if (!flags.keepBundle) {
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* best effort */ }
    } else {
      console.log(chalk.gray(`\nbundle kept: ${bundlePath}`));
    }
  };

  try {
    // ---- 3. dry run: builds every transaction, spends nothing --------------
    console.log(chalk.blue('Planning publish (dry run — nothing is broadcast)...\n'));
    const dry = await runPublisher({ ...baseOpts, broadcast: false });
    const totalSats = dry.plan.total_sats_needed;

    if (!flags.broadcast) {
      console.log(chalk.yellow('\nDry run complete. Nothing was broadcast.'));
      console.log(chalk.gray(`Cost if published: ${formatSats(totalSats)}`));
      console.log(chalk.gray('Add --broadcast to publish for real.'));
      return 0;
    }

    // ---- 4. funding -------------------------------------------------------
    let funding = flags.funding;
    if (!funding) {
      console.log(chalk.blue(`Selecting a funding UTXO for ${formatSats(totalSats)}...`));
      const selected = await selectFunding(key.address, totalSats);
      funding = selected.funding;
      console.log(chalk.green(`✓ funding: ${selected.txid}:${selected.vout} (${formatSats(selected.satoshis)})`));
      console.log(chalk.gray(`  address balance: ${formatSats(selected.total)}\n`));
    }

    // ---- 5. confirm before spending --------------------------------------
    if (!flags.yes) {
      // plan.tx_count, NOT files.length: the fixture also contains a synthetic
      // funding tx that is never broadcast, so files.length overstates by one.
      // This number is the last thing a user reads before spending — it has to
      // be the real count.
      const ok = await confirmPrompt(
        chalk.bold(`Broadcast ${dry.plan.tx_count} transactions and spend up to ${formatSats(totalSats)}? [y/N] `)
      );
      if (!ok) {
        console.log(chalk.yellow('Aborted. Nothing was broadcast.'));
        return 0;
      }
      console.log();
    }

    // ---- 6. bridge --------------------------------------------------------
    let bridges = flags.bridges;
    let localBridge = null;
    if (bridges.length === 0) {
      localBridge = await startBridge();
      bridges = [localBridge.url];
      console.log(chalk.gray(`bridge: ${localBridge.url} (local — forwards to WhatsOnChain → GorillaPool → TAAL)\n`));
    }

    try {
      const result = await runPublisher({ ...baseOpts, broadcast: true, funding, bridges });
      console.log(chalk.green.bold('\n✓ Published.'));
      console.log(chalk.gray('Every txid above is PENDING until mined. Verify with:'));
      console.log(chalk.gray(`  bgit publish --confirm --state ${path.join(result.outDir, 'publish-state.json')}`));
      console.log(chalk.gray(`\nReconstruct with:  bgit reconstruct --repo-id ${key.address}`));
      return 0;
    } finally {
      if (localBridge) await localBridge.close();
    }
  } catch (error) {
    // Upstream signals deliberate refusals with a REFUSED/… prefix; those are
    // the format protecting the user, not a crash, so present them as such.
    if (/^(REFUSED|FUNDING_|BROADCAST_)/.test(error.message)) {
      console.error(chalk.yellow(`\nRefused: ${error.message}`));
      return 2;
    }
    console.error(chalk.red(`\nPublish failed: ${error.message}`));
    return 1;
  } finally {
    cleanup();
  }
}

// ---------------------------------------------------------------------------
// bgit reconstruct
// ---------------------------------------------------------------------------

async function reconstructCommand(argv) {
  const flags = withSourceDefaults(parseFlags(argv));
  const { runReader } = await reader();

  if (!flags.repoId) {
    console.error(chalk.red('bgit reconstruct requires --repo-id <address>'));
    console.log(chalk.gray('\n  bgit reconstruct --repo-id <address> [--out <dir>]\n'));
    return 1;
  }

  if (flags.source && !flags.quiet) {
    console.log(chalk.gray(`source preset: ${flags.source}\n`));
  }

  try {
    const result = await runReader(flags);
    console.log(chalk.green.bold('\n✓ Reconstructed.'));
    // --out is the bundle FILE path, not a directory — git clones it directly.
    if (flags.out) {
      console.log(chalk.gray(`Clone the verified bundle with stock git:\n  git clone ${JSON.stringify(flags.out)} <dir>`));
    }
    return result && result.ok === false ? 1 : 0;
  } catch (error) {
    // bgitCode marks a verification refusal — a reader that refuses is working.
    if (error.bgitCode) {
      console.error(chalk.yellow(`\nRefused: ${error.message}`));
      return 2;
    }
    console.error(chalk.red(`\nReconstruct failed: ${error.message}`));
    return 1;
  }
}

// ---------------------------------------------------------------------------
// bgit claim
// ---------------------------------------------------------------------------

async function claimCommand(argv) {
  const flags = withSourceDefaults(parseFlags(argv));
  const { runClaim, runClaimConfirm } = await claim();

  if (flags.confirm) {
    try {
      await runClaimConfirm({ ...flags, txUrl: flags.txUrl || `${WHATSONCHAIN_API}/tx/hash/{txid}` });
      return 0;
    } catch (error) {
      console.error(chalk.red(`\nClaim confirm failed: ${error.message}`));
      return 1;
    }
  }

  if (!flags.repoId || !flags.domain) {
    console.error(chalk.red('bgit claim requires --repo-id <address> and --domain <yourproject.org>'));
    console.log(chalk.gray('\n  1. bgit claim --repo-id <addr> --domain you.org --out ./claim'));
    console.log(chalk.gray('  2. host the printed file at https://you.org/.well-known/bgit'));
    console.log(chalk.gray('  3. bgit claim ...same flags... --broadcast'));
    console.log(chalk.gray('  4. bgit claim --confirm --state ./claim/claim-state.json\n'));
    return 1;
  }

  let key;
  try {
    key = resolveKey(flags);
  } catch (error) {
    console.error(chalk.red(error.message));
    return 1;
  }

  const opts = { ...flags, key: key.wif, keyFile: undefined };

  let localBridge = null;
  try {
    if (flags.broadcast && flags.bridges.length === 0) {
      localBridge = await startBridge();
      opts.bridges = [localBridge.url];
      console.log(chalk.gray(`bridge: ${localBridge.url} (local)\n`));
    }
    await runClaim(opts);
    return 0;
  } catch (error) {
    console.error(chalk.red(`\nClaim failed: ${error.message}`));
    return 1;
  } finally {
    if (localBridge) await localBridge.close();
  }
}

// ---------------------------------------------------------------------------
// bgit chain <subcommand>
// ---------------------------------------------------------------------------

async function chainCommand(argv) {
  const sub = argv[0];

  if (sub === 'keygen') {
    const { wif, address } = generateKey();
    const flags = parseFlags(argv.slice(1));
    const out = flags.out;

    if (out) {
      const full = path.resolve(out);
      fs.writeFileSync(full, JSON.stringify({ wif, address }, null, 2), { mode: 0o600 });
      console.log(chalk.green(`✓ key written: ${full}  (mode 600)`));
      console.log(chalk.gray(`  address: ${address}`));
    } else {
      console.log(chalk.bold('\nNew publishing key\n'));
      console.log(`  address: ${chalk.cyan(address)}`);
      console.log(`  wif:     ${chalk.yellow(wif)}\n`);
      console.log(chalk.gray(`Store it in .env.local as ${DEFAULT_KEY_ENV}=<wif>, or re-run with --out key.json`));
    }
    console.log(chalk.red.bold('\n⚠  Anyone with this WIF controls the repository identity and its funds.'));
    console.log(chalk.gray(`Fund the address above, then: bgit publish --broadcast\n`));
    return 0;
  }

  if (sub === 'verify-vendor') {
    const { ok, results } = verifyVendor();
    console.log(chalk.bold('\nVendored source integrity (lib/chain/)\n'));
    for (const r of results) {
      const mark = r.ok ? chalk.green('✓') : chalk.red('✗');
      console.log(`  ${mark} ${r.file}`);
      if (!r.ok) {
        console.log(chalk.gray(`      expected ${r.expected}`));
        console.log(chalk.gray(`      actual   ${r.actual}`));
      }
    }
    if (ok) {
      console.log(chalk.green('\nAll vendored sources match the recorded upstream hashes.\n'));
      return 0;
    }
    console.log(chalk.red('\nVendored sources have DRIFTED from upstream.'));
    console.log(chalk.gray('These implement an unpatchable on-chain format. See lib/chain/UPSTREAM.md.\n'));
    return 1;
  }

  if (sub === 'spec') {
    const specPath = path.join(__dirname, 'chain', 'SPEC.md');
    console.log(fs.readFileSync(specPath, 'utf8'));
    return 0;
  }

  if (sub === 'credits') {
    console.log(chalk.bold('\nThe on-chain repository format is not bgit\'s work.\n'));
    console.log(`  Author:  ${chalk.cyan('Ryan Bennett (@zcoolz)')}`);
    console.log(`  Source:  ${chalk.cyan('https://github.com/zcoolz/bgit')}`);
    console.log(`  License: MIT`);
    console.log(`  Commit:  a6383c4ec55b45bdfa197c5185c3961247f0a2d0\n`);
    console.log(chalk.gray('The format, publisher, reader, claim mechanism, specification and test'));
    console.log(chalk.gray('vectors are his, vendored unmodified at lib/chain/. bgit adds bundling,'));
    console.log(chalk.gray('funding and broadcast convenience on top — the hard part was already done.\n'));
    console.log(chalk.gray('Verify the vendored bytes:  bgit chain verify-vendor'));
    console.log(chalk.gray('Read the specification:     bgit chain spec\n'));
    console.log(chalk.gray('The BSV funding/broadcast layer is ported from github.com/b0ase/bitgit.\n'));
    return 0;
  }

  console.error(chalk.red(`Unknown chain subcommand: ${sub || '(none)'}`));
  console.log(chalk.gray('\n  bgit chain keygen [--out key.json]   Generate a publishing key'));
  console.log(chalk.gray('  bgit chain verify-vendor             Check vendored source integrity'));
  console.log(chalk.gray('  bgit chain spec                      Print the on-chain format spec'));
  console.log(chalk.gray('  bgit chain credits                   Who wrote the on-chain format\n'));
  return 1;
}

const CHAIN_COMMANDS = new Set(['publish', 'reconstruct', 'claim', 'chain']);

/**
 * @param {string} command
 * @param {string[]} argv - arguments after the command
 * @returns {Promise<number>} exit code
 */
async function routeChainCommand(command, argv) {
  // Credit first, before any output the command produces — see showChainCredit.
  // Skipped for `chain credits` and `chain spec`, which carry it themselves.
  const selfCrediting = command === 'chain' && (argv[0] === 'credits' || argv[0] === 'spec');
  if (!argv.includes('--quiet') && !selfCrediting) {
    showChainCredit();
    console.log();
  }

  switch (command) {
    case 'publish': return publishCommand(argv);
    case 'reconstruct': return reconstructCommand(argv);
    case 'claim': return claimCommand(argv);
    case 'chain': return chainCommand(argv);
    default: throw new Error(`not a chain command: ${command}`);
  }
}

module.exports = {
  CHAIN_COMMANDS,
  routeChainCommand,
  publishCommand,
  reconstructCommand,
  claimCommand,
  chainCommand,
  parseFlags,
  inferRepoName,
};
