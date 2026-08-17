/**
 * Tests for bgit's integration layer.
 *
 * Scope: the code in lib/ that bgit wrote — flag parsing, key resolution, the
 * broadcast bridge, vendored-source integrity, and the publish command's
 * output/cleanup contract. The on-chain format itself is covered by upstream's
 * own vectors (lib/chain/bgit-vectors.test.mjs); this file deliberately does
 * not duplicate them.
 *
 * No test here spends money or requires network access.
 *
 *   pnpm run test:integration   # this file only
 *   pnpm test                   # this file + upstream's vectors
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { parseFlags, inferRepoName } = require('../lib/chain-commands');
const { resolveKey, generateKey, DEFAULT_KEY_ENV } = require('../lib/funding');
const { startBridge } = require('../lib/bridge-server');
const { verifyVendor } = require('../lib/chain-bridge');

const CLI = path.join(__dirname, '..', 'index.js');

/** Run the CLI, returning {status, stdout, stderr} without throwing. */
function runCli(args, opts = {}) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8',
      stdio: 'pipe',
      ...opts,
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    return {
      status: error.status === undefined ? 1 : error.status,
      stdout: error.stdout || '',
      stderr: error.stderr || '',
    };
  }
}

// ---------------------------------------------------------------------------

describe('parseFlags', () => {
  test('converts kebab-case flags to camelCase', () => {
    const f = parseFlags(['--repo-id', '1ABC', '--part-bytes', '700', '--local-out', './x']);
    assert.strictEqual(f.repoId, '1ABC');
    assert.strictEqual(f.partBytes, '700');
    assert.strictEqual(f.localOut, './x');
  });

  test('boolean flags consume no value', () => {
    const f = parseFlags(['--broadcast', '--yes', '--repo', 'a/b']);
    assert.strictEqual(f.broadcast, true);
    assert.strictEqual(f.yes, true);
    assert.strictEqual(f.repo, 'a/b', 'the flag after a boolean is still parsed');
  });

  test('--bridge accumulates instead of overwriting', () => {
    const f = parseFlags(['--bridge', 'http://a', '--bridge', 'http://b']);
    assert.deepStrictEqual(f.bridges, ['http://a', 'http://b']);
  });

  test('bridges is always an array, even when unused', () => {
    assert.deepStrictEqual(parseFlags([]).bridges, []);
  });

  /**
   * These commands spend money. A swallowed typo silently changes what happens,
   * so an unrecognised flag must stop the command rather than be ignored.
   */
  test('rejects an unknown flag rather than ignoring it', () => {
    assert.throws(() => parseFlags(['--boradcast']), /unknown flag: --boradcast/);
  });

  test('rejects a positional argument rather than dropping it', () => {
    assert.throws(() => parseFlags(['myrepo']), /unexpected argument: myrepo/);
  });

  test('rejects a value flag with no value', () => {
    assert.throws(() => parseFlags(['--repo']), /missing value for --repo/);
  });

  test('accepts every flag upstream documents', () => {
    // If upstream adds a flag and VALUE_FLAGS is not updated, this catches it.
    const upstream = [
      '--bundle', 'b', '--repo', 'r', '--key-file', 'k', '--part-bytes', '1',
      '--local-out', 'o', '--source-hint', 's', '--spec-txid', 't', '--label', 'l',
      '--published-at', 'p', '--funding', 'f', '--state', 'st', '--repo-id', 'ri',
      '--chain-in', 'ci', '--history-url', 'h', '--tx-url', 'tx', '--source', 'src',
      '--role', 'ro', '--status-url', 'su', '--local-in', 'li', '--out', 'ou',
      '--report', 're', '--domain', 'd',
    ];
    assert.doesNotThrow(() => parseFlags(upstream));
  });
});

// ---------------------------------------------------------------------------

describe('resolveKey', () => {
  test('prefers an explicit --key over the environment', () => {
    const { wif } = generateKey();
    const prev = process.env[DEFAULT_KEY_ENV];
    process.env[DEFAULT_KEY_ENV] = generateKey().wif;
    try {
      const r = resolveKey({ key: wif });
      assert.strictEqual(r.wif, wif);
      assert.strictEqual(r.source, '--key');
    } finally {
      if (prev === undefined) delete process.env[DEFAULT_KEY_ENV];
      else process.env[DEFAULT_KEY_ENV] = prev;
    }
  });

  test('reads a key file of shape { wif }', () => {
    const { wif, address } = generateKey();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgit-key-'));
    const file = path.join(dir, 'k.json');
    fs.writeFileSync(file, JSON.stringify({ wif }));
    try {
      const r = resolveKey({ keyFile: file });
      assert.strictEqual(r.wif, wif);
      assert.strictEqual(r.address, address, 'derives the matching address');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('falls back to the environment variable', () => {
    const { wif, address } = generateKey();
    const prev = process.env[DEFAULT_KEY_ENV];
    process.env[DEFAULT_KEY_ENV] = wif;
    try {
      const r = resolveKey({});
      assert.strictEqual(r.address, address);
      assert.match(r.source, /BSV_PRIVATE_KEY/);
    } finally {
      if (prev === undefined) delete process.env[DEFAULT_KEY_ENV];
      else process.env[DEFAULT_KEY_ENV] = prev;
    }
  });

  test('rejects a malformed WIF instead of failing later at signing', () => {
    assert.throws(() => resolveKey({ key: 'not-a-wif' }), /not a valid WIF/);
  });

  test('key file missing the wif field names the file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgit-key-'));
    const file = path.join(dir, 'bad.json');
    fs.writeFileSync(file, JSON.stringify({ nope: 1 }));
    try {
      assert.throws(() => resolveKey({ keyFile: file }), /no usable "wif" field/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  /** Confusing the HandCash wallet with the raw publishing key is the likeliest
   *  user mistake, so the "no key" error has to say so. */
  test('missing key explains that HandCash is not the publishing key', () => {
    const prev = process.env[DEFAULT_KEY_ENV];
    delete process.env[DEFAULT_KEY_ENV];
    try {
      assert.throws(() => resolveKey({}), /custodial wallet cannot do/);
    } finally {
      if (prev !== undefined) process.env[DEFAULT_KEY_ENV] = prev;
    }
  });
});

// ---------------------------------------------------------------------------

describe('broadcast bridge', () => {
  test('rejects non-POST', async () => {
    const b = await startBridge();
    try {
      const res = await fetch(b.url, { method: 'GET' });
      assert.strictEqual(res.status, 405);
    } finally {
      await b.close();
    }
  });

  test('rejects malformed JSON', async () => {
    const b = await startBridge();
    try {
      const res = await fetch(b.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });
      assert.strictEqual(res.status, 400);
    } finally {
      await b.close();
    }
  });

  test('rejects a rawTx that is not even-length hex', async () => {
    const b = await startBridge();
    try {
      for (const rawTx of ['zz', 'abc', 42, null]) {
        const res = await fetch(b.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rawTx }),
        });
        assert.strictEqual(res.status, 400, `rawTx=${JSON.stringify(rawTx)} must be refused`);
      }
    } finally {
      await b.close();
    }
  });

  test('binds to loopback only', async () => {
    const b = await startBridge();
    try {
      assert.match(b.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    } finally {
      await b.close();
    }
  });

  test('close() is awaitable and releases the port', async () => {
    const b = await startBridge();
    const { port } = b;
    await b.close();
    const b2 = await startBridge();
    try {
      assert.notStrictEqual(b2.port, undefined);
    } finally {
      await b2.close();
    }
    assert.ok(port > 0);
  });
});

// ---------------------------------------------------------------------------

describe('vendored source integrity', () => {
  test('vendored modules match the recorded upstream hashes', () => {
    const { ok, results } = verifyVendor();
    const drifted = results.filter((r) => !r.ok).map((r) => r.file);
    assert.ok(ok, `vendored sources drifted: ${drifted.join(', ')}`);
    assert.strictEqual(results.length, 3);
  });

  test('the CLI reports integrity and exits 0', () => {
    const r = runCli(['chain', 'verify-vendor']);
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout, /All vendored sources match/);
  });

  test('credits name the upstream author', () => {
    const r = runCli(['chain', 'credits']);
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout, /Ryan Bennett/);
    assert.match(r.stdout, /github\.com\/zcoolz\/bgit/);
  });
});

// ---------------------------------------------------------------------------

describe('CLI surface', () => {
  test('--version reports bgit, not git', () => {
    const r = runCli(['--version']);
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout, /^bgit \d+\.\d+\.\d+/);
    assert.doesNotMatch(r.stdout, /git version/, 'must not fall through to git');
  });

  test('bare `version` still passes through to git', () => {
    const r = runCli(['version']);
    assert.match(r.stdout, /git version/);
  });

  test('publish outside a git repo without --bundle fails cleanly', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgit-norepo-'));
    try {
      const r = runCli(['publish'], { cwd: dir });
      assert.notStrictEqual(r.status, 0);
      assert.match(r.stdout + r.stderr, /Not inside a git repository/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('reconstruct without --repo-id explains the usage', () => {
    const r = runCli(['reconstruct']);
    assert.notStrictEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /--repo-id/);
  });
});

// ---------------------------------------------------------------------------

describe('publish output and cleanup contract', () => {
  /** Build a throwaway repo so publish has something to bundle. */
  function makeRepo() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgit-repo-'));
    const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
    execFileSync('git', ['init', '-q', dir], { stdio: 'pipe' });
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'test');
    fs.writeFileSync(path.join(dir, 'f.txt'), 'hello\n');
    git('add', '.');
    git('commit', '-q', '-m', 'init');
    return dir;
  }

  test('a dry run leaves nothing behind in the working directory', () => {
    const dir = makeRepo();
    try {
      const r = runCli(['publish'], {
        cwd: dir,
        env: { ...process.env, [DEFAULT_KEY_ENV]: generateKey().wif },
      });
      assert.strictEqual(r.status, 0, r.stderr);
      assert.match(r.stdout, /Dry run complete/);
      assert.ok(!fs.existsSync(path.join(dir, 'bgit-publish')),
        'a dry run must not litter the repo');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * REGRESSION (bd3db41): outDir used to default inside the temp bundle dir,
   * which cleanup() removed in a finally block. On the broadcast path that
   * destroyed publish-state.json — the only record of which txids were sent,
   * and the input `--confirm` needs. Money spent, no way to confirm.
   *
   * This publish fails at funding (the key is unfunded, so nothing is spent),
   * but the output directory must already exist and survive the command.
   */
  test('a broadcast run persists its output directory', () => {
    const dir = makeRepo();
    try {
      const r = runCli(['publish', '--broadcast', '--yes'], {
        cwd: dir,
        env: { ...process.env, [DEFAULT_KEY_ENV]: generateKey().wif },
      });
      assert.notStrictEqual(r.status, 0, 'an unfunded key cannot publish');
      assert.match(r.stdout + r.stderr, /Insufficient funding/);

      const outDir = path.join(dir, 'bgit-publish');
      assert.ok(fs.existsSync(outDir),
        'the publish fixture must outlive the command so --confirm can read it');
      assert.ok(fs.existsSync(path.join(outDir, 'chain.json')),
        'the transaction fixture must be present');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('the dry run reports a cost and spends nothing', () => {
    const dir = makeRepo();
    try {
      const r = runCli(['publish'], {
        cwd: dir,
        env: { ...process.env, [DEFAULT_KEY_ENV]: generateKey().wif },
      });
      assert.match(r.stdout, /Cost if published: [\d,]+ sats/);
      assert.match(r.stdout, /NOT BROADCAST/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------

describe('repo name inference', () => {
  test('infers owner/name from an origin remote', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgit-infer-'));
    try {
      execFileSync('git', ['init', '-q', dir], { stdio: 'pipe' });
      execFileSync('git', ['-C', dir, 'remote', 'add', 'origin',
        'git@github.com:someone/thing.git'], { stdio: 'pipe' });
      const cwd = process.cwd();
      process.chdir(dir);
      try {
        assert.strictEqual(inferRepoName(), 'someone/thing');
      } finally {
        process.chdir(cwd);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
