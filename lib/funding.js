/**
 * BSV funding and broadcast layer for the on-chain repository commands.
 *
 * CommonJS port of b0ase/bitgit's src/bsv/utxo.ts and src/bsv/broadcast.ts.
 *
 * WHY THIS EXISTS, AND WHY HANDCASH CANNOT DO IT
 * ----------------------------------------------
 * bgit's commit/push gating uses HandCash, which is custodial: the Connect SDK
 * exposes account.wallet.pay() and getSpendableBalance() and nothing lower. It
 * never yields a raw private key or a spendable outpoint.
 *
 * Publishing a repository needs both. Upstream's publisher signs data-carrying
 * transactions with the *repository key* and spends a *named outpoint* that it
 * verifies provably pays that key before it will sign (FUNDING_NOT_OURS).
 * A custodial pay() call cannot satisfy either requirement.
 *
 * So the two money paths stay separate, on purpose:
 *
 *   commit / push  → HandCash OAuth   → pay-to-operate premium to the treasury
 *   publish / claim → raw WIF key     → data transactions funded from your own UTXO
 *
 * Nothing here touches the HandCash path, and `bgit auth login` is not required
 * to publish or reconstruct.
 */

const fs = require('fs');
const path = require('path');
const { PrivateKey, P2PKH } = require('@bsv/sdk');

const WHATSONCHAIN_API = 'https://api.whatsonchain.com/v1/bsv/main';
const GORILLAPOOL_ARC = 'https://arc.gorillapool.io/v1/tx';
const TAAL_ARC = 'https://arc.taal.com/v1/tx';

const FETCH_TIMEOUT_MS = 30_000;

/** Default env var holding the publisher WIF. Matches bitgit's convention. */
const DEFAULT_KEY_ENV = 'BSV_PRIVATE_KEY';

// ---------------------------------------------------------------------------
// key resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the publishing WIF from (in order) an explicit WIF, a key file, or the
 * environment.
 *
 * The WIF is returned for in-process use only. Callers pass it to upstream as
 * `{ key: wif }` rather than writing a temp key file, so the secret never lands
 * on disk. Never log the return value.
 *
 * @param {{key?: string, keyFile?: string, keyEnv?: string}} opts
 * @returns {{wif: string, address: string, source: string}}
 */
function resolveKey(opts = {}) {
  const keyEnv = opts.keyEnv || DEFAULT_KEY_ENV;
  let wif = null;
  let source = null;

  if (opts.key) {
    wif = opts.key;
    source = '--key';
  } else if (opts.keyFile) {
    const full = path.resolve(opts.keyFile);
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch (error) {
      throw new Error(`--key-file unreadable: ${full} (${error.message})`);
    }
    if (typeof parsed.wif !== 'string' || parsed.wif.length === 0) {
      throw new Error(`--key-file has no usable "wif" field: ${full}`);
    }
    wif = parsed.wif;
    source = `--key-file ${full}`;
  } else if (process.env[keyEnv]) {
    wif = process.env[keyEnv];
    source = `$${keyEnv}`;
  }

  if (!wif) {
    throw new Error(
      `No publishing key found.\n\n` +
      `Provide one of:\n` +
      `  --key-file <publisher-key.json>   a JSON file shaped { "wif": "..." }\n` +
      `  $${keyEnv}                        a WIF in your environment or .env.local\n\n` +
      `Generate a fresh key with:  bgit chain keygen\n\n` +
      `This key is NOT your HandCash wallet. Publishing signs raw BSV transactions,\n` +
      `which a custodial wallet cannot do.`
    );
  }

  let address;
  try {
    address = PrivateKey.fromWif(wif).toAddress().toString();
  } catch (error) {
    throw new Error(`Publishing key is not a valid WIF (from ${source}): ${error.message}`);
  }

  return { wif, address, source };
}

/**
 * Generate a fresh publishing keypair.
 *
 * @returns {{wif: string, address: string}}
 */
function generateKey() {
  const key = PrivateKey.fromRandom();
  return { wif: key.toWif(), address: key.toAddress().toString() };
}

// ---------------------------------------------------------------------------
// UTXO selection
// ---------------------------------------------------------------------------

async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetch all UTXOs for an address, largest first.
 *
 * @param {string} address
 * @returns {Promise<Array<{txid: string, vout: number, satoshis: number}>>}
 */
async function fetchUtxos(address) {
  const url = `${WHATSONCHAIN_API}/address/${address}/unspent`;
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch UTXOs for ${address}: HTTP ${response.status} ${response.statusText}`);
  }
  const raw = await response.json();
  return raw
    .sort((a, b) => b.value - a.value)
    .map((u) => ({ txid: u.tx_hash, vout: u.tx_pos, satoshis: u.value }));
}

/**
 * Select one UTXO holding at least `minSats` and format it as upstream's
 * `--funding <txid>:<vout>:<sats>` triple.
 *
 * Upstream requires a SINGLE outpoint that covers the whole publish — it chains
 * change from each transaction into the next rather than gathering inputs. So a
 * wallet holding enough in aggregate but nothing big enough in one coin will
 * fail here, and the error says so rather than reporting a bare balance.
 *
 * @param {string} address
 * @param {number} minSats
 * @param {string[]} excludeTxids
 * @returns {Promise<{funding: string, txid: string, vout: number, satoshis: number, total: number}>}
 */
async function selectFunding(address, minSats, excludeTxids = []) {
  const utxos = await fetchUtxos(address);
  const total = utxos.reduce((sum, u) => sum + u.satoshis, 0);
  const eligible = utxos.filter(
    (u) => u.satoshis >= minSats && !excludeTxids.includes(u.txid)
  );

  if (eligible.length === 0) {
    const detail = total >= minSats
      ? `Address holds ${total} sats across ${utxos.length} UTXOs, but no SINGLE coin has ${minSats}.\n` +
        `Publishing chains change from one transaction into the next, so it needs one\n` +
        `outpoint that covers the whole run. Consolidate your UTXOs and retry.`
      : `Address holds ${total} sats across ${utxos.length} UTXOs; the publish needs ${minSats}.`;
    throw new Error(`Insufficient funding at ${address}.\n\n${detail}`);
  }

  const chosen = eligible[0];
  return {
    funding: `${chosen.txid}:${chosen.vout}:${chosen.satoshis}`,
    ...chosen,
    total,
  };
}

// ---------------------------------------------------------------------------
// broadcast
// ---------------------------------------------------------------------------

/**
 * Broadcast a signed transaction, falling back across providers.
 *
 * Chain: WhatsOnChain → GorillaPool ARC → TAAL ARC.
 *
 * @param {string} rawTx - Raw transaction hex
 * @returns {Promise<{txid: string, provider: string}>}
 */
async function broadcast(rawTx) {
  /** @type {Array<{provider: string, status: number|null, detail: string}>} */
  const failures = [];

  const attempts = [
    {
      provider: 'whatsonchain',
      url: `${WHATSONCHAIN_API}/tx/raw`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txhex: rawTx }),
      },
      parse: async (res) => (await res.text()).replace(/"/g, '').trim(),
    },
    {
      provider: 'gorillapool',
      url: GORILLAPOOL_ARC,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: Buffer.from(rawTx, 'hex'),
      },
      parse: async (res) => ((await res.json()).txid || '').trim(),
    },
    {
      provider: 'taal',
      url: TAAL_ARC,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: Buffer.from(rawTx, 'hex'),
      },
      parse: async (res) => ((await res.json()).txid || '').trim(),
    },
  ];

  for (const attempt of attempts) {
    try {
      const res = await fetchWithTimeout(attempt.url, attempt.init, 120_000);
      if (res.ok) {
        return { txid: await attempt.parse(res), provider: attempt.provider };
      }
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      failures.push({ provider: attempt.provider, status: res.status, detail });
    } catch (error) {
      // No status: the provider was never reached, so it rendered no verdict.
      failures.push({ provider: attempt.provider, status: null, detail: error.message });
    }
  }

  const summary = failures
    .map((f) => `${f.provider}: ${f.status ? `HTTP ${f.status} ` : ''}${f.detail}`)
    .join('\n  ');
  const error = new Error(`Broadcast failed on all providers:\n  ${summary}`);

  /**
   * Structured detail so callers can tell a network verdict from a transport
   * failure. Only a 4xx is the network judging the transaction itself; a 5xx or
   * an unreachable host says nothing about validity, and treating it as a
   * rejection would abort a publish over someone else's outage.
   */
  error.providerFailures = failures;
  error.isNetworkVerdict =
    failures.length > 0 &&
    failures.every((f) => typeof f.status === 'number' && f.status >= 400 && f.status < 500);

  throw error;
}

module.exports = {
  DEFAULT_KEY_ENV,
  WHATSONCHAIN_API,
  resolveKey,
  generateKey,
  fetchUtxos,
  selectFunding,
  broadcast,
};
