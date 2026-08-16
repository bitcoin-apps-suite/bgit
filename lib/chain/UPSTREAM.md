# Vendored upstream — `zcoolz/bgit`

The four `.mjs` files in this directory, plus `SPEC.md` and `AUDIT.md`, are vendored
**verbatim** from an independent project that shares our name:

| | |
|---|---|
| Source | https://github.com/zcoolz/bgit |
| Commit | `a6383c4ec55b45bdfa197c5185c3961247f0a2d0` |
| Upstream version | `1.0.0-rc.1` |
| Author | Ryan Bennett (`zcoolz`) |
| License | MIT — see `LICENSE.upstream` |

## SHA-256 of vendored sources

```
09cf2c8682c377af8bc264946e7d7176e701842b678ae0f793dabd10fdb3ef1e  publisher.mjs
2a01adfdbceb4cfcba088b2b68a76855ebb5a45eefe5b7ef07b3d5997dcfcedd  reader.mjs
36b0989f69be987272726a345c9db25405bf5e12a551dd3830311671cb9cba31  claim.mjs
```

Re-verify at any time with `node index.js chain verify-vendor`.

## Why verbatim, and why that matters

**Do not edit these files.** They are not ordinary dependencies — they are an
implementation of a consensus format that is written to a blockchain and can never be
patched after the fact. Three properties depend on the bytes being unchanged:

1. **Spec conformance.** `SPEC.md` is itself published on chain in its own format. A
   reader that drifts from the spec cannot reconstruct repositories that conforming
   publishers wrote, and vice versa.
2. **The adversarial review holds only for this code.** The format survived three
   review rounds by OpenAI's Codex against a Claude-built design. Every finding was
   folded into these bytes. An edit voids that review.
3. **The 22 test vectors pin these exact implementations.** `bgit-vectors.test.mjs`
   covers signature vectors across two independent implementations, every rejection
   class, fork races at every height, claim replay, and a full
   publish→reconstruct→clone loop. Run them with `pnpm test`.

`AUDIT.md` lists 13 formal findings from a reader implemented against the spec text
alone; two became normative security law. Read it before implementing anything that
touches record parsing.

## How we integrate without touching them

All bgit-specific behaviour lives *outside* this directory:

| File | Role |
|---|---|
| `lib/chain-bridge.js` | CommonJS → ESM loader (our CLI is CJS, upstream is ESM) |
| `lib/funding.js` | UTXO selection + broadcast fallback (supplies `--funding`) |
| `lib/bridge-server.js` | Local `POST {rawTx}` bridge satisfying their broadcast contract |
| `lib/chain-commands.js` | `bgit publish` / `reconstruct` / `claim` CLI surface |

Upstream's CLI entry points are guarded by an `import.meta.url` check, so importing
these modules as libraries never triggers their argument parsing.

## Known upstream issue: vector 7b fails on macOS

`pnpm test` reports **29/30 passing**. Vector 7b ("BITE: a publisher that corrupts one
part byte is caught by the reader") fails on macOS. This is an upstream
test-environment bug, not a defect in the format, and not something our vendoring
introduced — it reproduces identically in a clean clone of `zcoolz/bgit` at
`a6383c4` with upstream's own `npm install`.

**Cause.** All three modules detect CLI invocation with:

```js
pathToFileURL(resolve(process.argv[1])).href === import.meta.url
```

`resolve()` does not resolve symlinks, but Node realpath-resolves `import.meta.url`.
On macOS `/tmp` → `/private/tmp` and `/var` → `/private/var`, so a module executed
from a temp directory compares `file:///var/folders/…` against
`file:///private/var/folders/…` and never matches. The CLI block silently does not
run: the process exits 0 having written nothing. Vector 7b then fails at its *second*
assertion, reporting `SOURCE_UNREADABLE: no chain.json` instead of the
`PART_SHA_MISMATCH` it was looking for — which reads like a verification failure but
is the opposite: the publisher under test never produced anything to verify.

**The property under test is intact.** Re-running the same corruption by invoking the
publisher through a realpath'd path produces the expected refusal:

```
BGIT_REFUSED PART_SHA_MISMATCH: parts[0] …: sha256 6b86a87a… != manifest a9aa1465…
artifact written: NO
```

The reader catches the corrupted byte and leaves no partial artifact. Nothing about
corruption detection is broken.

**We are not affected.** Our CLI imports these modules as libraries and calls
`runPublisher` / `runReader` / `runClaim` directly, so `isMain` is *expected* to be
false and is never relied on. The bug can only bite someone invoking the vendored
`.mjs` files as scripts through a symlinked path.

Do not patch this locally — it would break the hashes above and void the review that
the vendored bytes carry. It belongs upstream; the one-line fix is to realpath
`process.argv[1]` before comparing.

## Updating

1. Diff upstream against this directory.
2. Copy in wholesale — never cherry-pick hunks into a modified local copy.
3. Update the commit SHA and hashes above.
4. Run `pnpm test`. If any vector fails, stop: the format changed in a way that needs
   deliberate handling, not a green checkmark.

Upstream's read-old-forever rule means a v2 reader must keep reading v1 records. Our
CLI must never require a newer format version than the repositories it may encounter.
