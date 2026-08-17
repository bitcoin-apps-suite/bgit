/**
 * `bgit verify` — check a local bundle against its on-chain commitment,
 * without downloading the payload.
 *
 * The reader's full reconstruct path fetches every PART transaction, hashes
 * them, concatenates, and hands back a bundle. That is the right thing when you
 * have nothing but an address. It is wasteful when you already hold the bundle
 * and only want to know whether it is the one the chain attests to.
 *
 * This performs steps 1-5 of the reader's verification and stops before the
 * parts fetch:
 *
 *   1. walk the address and collect signed records
 *   2. resolve the ref chain (fork resolution, claim authority)
 *   3. take the winning tip's artifact manifest
 *   4. confirm the manifest's signer is authorized at its mined position
 *   5. cross-check the tip's refs_sha256 against the manifest
 *
 * then compares the local bundle's sha256, byte length, and ref digest against
 * that manifest. Every check is the vendored implementation's own — nothing
 * here re-implements signature or chain logic.
 *
 * IMPORTANT: this proves the bundle matches what the chain says. It does not
 * prove the payload is recoverable from the chain — only a reconstruct does
 * that. The two answer different questions and the output says so.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const chalk = require('chalk');

const { reader } = require('./chain-bridge');

/**
 * @param {object} flags - parsed CLI flags
 * @returns {Promise<number>} exit code (0 ok, 1 error, 2 verification refusal)
 */
async function verifyCommand(flags) {
  const {
    collectRecords, resolveChain, authorizedKeysAt, refsDigestOfBundle,
    readLocalTxs, readNetworkTxs, SOURCE_PRESETS,
  } = await reader();

  if (!flags.repoId || !flags.bundle) {
    console.error(chalk.red('bgit verify requires --repo-id <address> and --bundle <path>'));
    console.log(chalk.gray('\n  bgit verify --repo-id <address> --bundle ./repo.bundle\n'));
    console.log(chalk.gray('Checks a bundle you already hold against its on-chain commitment,'));
    console.log(chalk.gray('without downloading the payload. To recover a bundle you do not'));
    console.log(chalk.gray('have, use `bgit reconstruct` instead.\n'));
    return 1;
  }

  const bundlePath = path.resolve(flags.bundle);
  if (!fs.existsSync(bundlePath)) {
    console.error(chalk.red(`bundle not found: ${bundlePath}`));
    return 1;
  }

  // ---- gather the chain -----------------------------------------------------
  //
  // readLocalTxs returns { txs, orderAuthoritative }; readNetworkTxs returns the
  // array. orderAuthoritative must be threaded into resolveChain: a local
  // fixture declares a total mined order, a network walk does not, and fork
  // resolution depends on knowing which. Defaulting it would silently change
  // which ref wins a tie.
  let txs;
  let orderAuthoritative;
  try {
    if (flags.localIn) {
      const src = readLocalTxs(path.resolve(flags.localIn));
      txs = src.txs;
      orderAuthoritative = src.orderAuthoritative;
    } else {
      const preset = SOURCE_PRESETS[flags.source || 'woc'] || {};
      const historyUrl = flags.historyUrl || preset.historyUrl;
      const txUrl = flags.txUrl || preset.txUrl;
      if (!historyUrl || !txUrl) {
        console.error(chalk.red('need --history-url and --tx-url (or a --source preset, or --local-in)'));
        return 1;
      }
      txs = await readNetworkTxs(historyUrl, txUrl, flags.repoId);
      orderAuthoritative = false;
    }
  } catch (error) {
    console.error(chalk.red(`could not read the chain: ${error.message}`));
    return 1;
  }

  // ---- resolve to the winning artifact manifest -----------------------------
  let artifact;
  let tip;
  try {
    const col = collectRecords(txs, flags.repoId);
    const resolved = resolveChain(col.refs, col.claims, { orderAuthoritative });
    tip = resolved.tip;

    if (!tip) {
      console.error(chalk.yellow('\nRefused: no valid ref chain found for this repo-id.'));
      console.log(chalk.gray('An empty walk from one source proves nothing — cross-check another source.'));
      return 2;
    }

    artifact = col.artifacts.get(tip.artifact);
    if (!artifact) {
      console.error(chalk.yellow(`\nRefused: the winning tip cites artifact ${tip.artifact.slice(0, 12)}… which is not present in this walk.`));
      return 2;
    }

    // The manifest's signer must be authorized by the ref chain at its mined
    // position — a foreign-signed manifest is invalid, full stop (SPEC v1.3 §3).
    const auth = authorizedKeysAt(resolved.report, artifact.minedIdx);
    if (!auth.has(artifact.pubkey.toLowerCase())) {
      console.error(chalk.yellow(`\nRefused: artifact manifest is signed by ${artifact.pubkey.slice(0, 16)}…, which is not an authorized key of this ref chain.`));
      return 2;
    }

    if (tip.refs_sha256 !== String(artifact.json.bundle_refs_sha256).toLowerCase()) {
      console.error(chalk.yellow('\nRefused: the ref tip and artifact manifest disagree on the ref digest.'));
      return 2;
    }
  } catch (error) {
    console.error(chalk.red(`\nchain verification failed: ${error.message}`));
    return error.bgitCode ? 2 : 1;
  }

  // ---- compare the local bundle --------------------------------------------
  const bytes = fs.statSync(bundlePath).size;
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(bundlePath)).digest('hex');

  let refsDigest = null;
  let refsDigestError = null;
  try {
    refsDigest = refsDigestOfBundle(bundlePath);
  } catch (error) {
    refsDigestError = error.message;
  }

  const expected = {
    sha256: String(artifact.json.artifact_sha256).toLowerCase(),
    bytes: artifact.json.artifact_bytes,
    refs: String(artifact.json.bundle_refs_sha256).toLowerCase(),
  };

  const checks = [
    { name: 'artifact_sha256', ok: sha256 === expected.sha256, got: sha256, want: expected.sha256 },
    { name: 'artifact_bytes', ok: bytes === expected.bytes, got: String(bytes), want: String(expected.bytes) },
    {
      name: 'bundle_refs_sha256',
      ok: refsDigest !== null && refsDigest === expected.refs,
      got: refsDigest === null ? `unreadable (${refsDigestError})` : refsDigest,
      want: expected.refs,
    },
  ];

  // ---- report ---------------------------------------------------------------
  console.log(chalk.bold('\nOn-chain commitment\n'));
  console.log(chalk.gray(`  repo_id:  ${flags.repoId}`));
  console.log(chalk.gray(`  tip:      seq=${tip.seq} ${tip.txid.slice(0, 16)}… (${tip.role || 'unknown role'})`));
  console.log(chalk.gray(`  manifest: ${artifact.txid.slice(0, 16)}… signed by ${artifact.pubkey.slice(0, 16)}…`));
  if (artifact.json.repo) console.log(chalk.gray(`  repo:     ${artifact.json.repo}`));

  console.log(chalk.bold('\nLocal bundle vs commitment\n'));
  for (const c of checks) {
    const mark = c.ok ? chalk.green('✓') : chalk.red('✗');
    console.log(`  ${mark} ${c.name}`);
    if (!c.ok) {
      console.log(chalk.gray(`      on chain: ${c.want}`));
      console.log(chalk.gray(`      local:    ${c.got}`));
    }
  }

  const allOk = checks.every((c) => c.ok);
  if (!allOk) {
    console.log(chalk.red.bold('\n✗ MISMATCH — this bundle is not what the chain attests to.\n'));
    return 2;
  }

  console.log(chalk.green.bold('\n✓ VERIFIED'));
  console.log(chalk.gray(`${path.basename(bundlePath)} is byte-identical to the artifact committed by ${flags.repoId}.`));

  // Say plainly what this did and did not establish. A verify is not a
  // reconstruct, and the difference matters if the parts were never published.
  console.log(chalk.gray('\nThis checked the bundle against the signed on-chain manifest.'));
  console.log(chalk.gray('It did NOT fetch the payload, so it does not prove the bundle is'));
  console.log(chalk.gray('recoverable from the chain — run `bgit reconstruct` to establish that.'));

  if (tip.role === 'unsigned-mirror') {
    console.log(chalk.yellow('\nNote: this chain is an UNSIGNED MIRROR — the project itself has not'));
    console.log(chalk.yellow('signed it. The commitment is real; the authority behind it is not claimed.'));
  }
  if (tip.mined === false) {
    console.log(chalk.yellow('\nNote: the tip is not yet mined. Treat this as PENDING.'));
  }

  return 0;
}

module.exports = { verifyCommand };
