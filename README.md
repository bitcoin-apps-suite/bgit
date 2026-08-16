# bgit - Bitcoin-Enabled Git Wrapper

**Version:** 3.0.0
**Timestamp your commits with HandCash — and publish whole repositories to BitcoinSV, clonable back with stock git**

```
██████╗       ██████╗ ██╗████████╗
██╔══██╗     ██╔════╝ ██║╚══██╔══╝
██████╔╝     ██║  ███╗ ██║   ██║
██╔══██╗     ██║   ██║ ██║   ██║
██████╔╝ ██╗ ╚██████╔╝ ██║   ██║
╚═════╝  ╚═╝  ╚═════╝  ╚═╝   ╚═╝

> Bitcoin-Native Git Wrapper
> Pay-to-Operate • Universal History
```

---

## ⚡ The on-chain format is Ryan Bennett's work, not ours

Everything in bgit v3 that publishes a repository to Bitcoin and clones it back —
the **format, the publisher, the reader, the claim mechanism, the specification, and
the test vectors** — was designed and written by
**[Ryan Bennett (@zcoolz)](https://github.com/zcoolz)** at
**[github.com/zcoolz/bgit](https://github.com/zcoolz/bgit)**.

We did not invent it. We did not reimplement it. We did not improve it. It is
[vendored **unmodified**](./lib/chain/) under the MIT license, byte-for-byte, and
`bgit chain verify-vendor` will prove it to you at any time.

Before its first broadcast, that format survived **three adversarial review rounds by
OpenAI's Codex** against a Claude-built design, and it ships its own audit record of
13 formal findings. It published Monero's complete 13,241-commit history to Bitcoin
for about six dollars. That work is his.

**If this capability is why you are here, go star
[zcoolz/bgit](https://github.com/zcoolz/bgit) and read
[his spec](./lib/chain/SPEC.md).** What bgit adds on top is convenience —
auto-bundling, funding, and broadcast plumbing. The hard part was already done.

> **Note on the name.** `zcoolz/bgit` and this project were built independently and
> share a name by coincidence. His is the on-chain repository format; ours started as
> a HandCash-gated git wrapper. Neither of us owns the name — we would rather say so
> plainly than let anyone assume his work is ours.

---

## What is bgit?

bgit does two distinct things, and it is worth being clear which is which.

**1. Timestamp commits (v1–v2).** A git wrapper that timestamps your commits on the
**BitcoinSV blockchain** using **HandCash** micropayments. Every commit gets a
cryptographically provable timestamp on-chain. This proves *when* something happened.

**2. Publish repositories (v3).** Pack the repo with `git bundle`, write it into BSV
transactions as plain data, and reconstruct it later from nothing but a transaction
source — producing a `.bundle` that **stock git clones**. This preserves *what the
repository was*, with no platform and no company required to stay alive for your
history to be recoverable.

The second capability is **not our design** — it is
[Ryan Bennett's format](https://github.com/zcoolz/bgit), vendored unmodified under
MIT. See the credit at the top of this file, and [`NOTICE`](./NOTICE).

> **Erasure resistant, not availability guaranteed.** Recovery works while at least
> one archival copy exists and some source will serve it — and anyone may be that
> source. Git clones the reconstructed bundle, not the blockchain directly. The full
> limits are in [`lib/chain/SPEC.md`](./lib/chain/SPEC.md); read them before relying
> on this.

### Two money paths, deliberately separate

| | Funded by | Used for |
|---|---|---|
| `commit`, `push` | **HandCash OAuth** (custodial) | Pay-to-operate premium, 0.001 BSV |
| `publish`, `claim` | **Raw BSV key** (your own UTXO) | Data transactions carrying the repo |

These cannot be merged. HandCash Connect exposes `wallet.pay()` and nothing lower —
it never yields a private key or a spendable outpoint. Publishing signs
data-carrying transactions with the repository key and spends a named outpoint it
verifies provably pays that key before it will sign. A custodial wallet cannot do
either. **You do not need `bgit auth login` to publish or reconstruct.**

---

## Publishing a repository to Bitcoin

```bash
# 1. Generate a publishing key (this is NOT your HandCash wallet)
bgit chain keygen --out publisher-key.json
#    or: put a WIF in .env.local as BSV_PRIVATE_KEY=...

# 2. Dry run — bundles the repo, builds every transaction, tells you the exact
#    cost, and spends nothing. This is the default.
bgit publish

# 3. Fund the printed address, then publish for real.
#    Funding UTXO selection and broadcasting are automatic; you are asked to
#    confirm before a single satoshi moves.
bgit publish --broadcast

# 4. Only this pass may report acceptance. A relay ack is not acceptance.
bgit publish --confirm --state ./bgit-publish/publish-state.json
```

Every txid reports **PENDING** until `--confirm` finds it mined.

### Reconstructing a repository from the chain

```bash
bgit reconstruct --repo-id <the repo address> --out ./recovered.bundle
git clone ./recovered.bundle my-repo
```

The reader walks the address, collects the records, verifies every signature and
every hash, and refuses anything that does not check out. It needs no cooperation
from us — only a source that still serves the data.

### Claiming a mirror you maintain

A repository someone else mirrored begins as `unsigned-mirror`, `claimable: true` —
a label saying *the project itself has not signed this*.

```bash
bgit claim --repo-id <addr> --domain yourproject.org --out ./claim   # dry run
# host the printed file at https://yourproject.org/.well-known/bgit, then:
bgit claim --repo-id <addr> --domain yourproject.org --out ./claim --broadcast
bgit claim --confirm --state ./claim/claim-state.json
```

A claim proves control of a key and a domain **at the moment it is mined** — not
project authorship. No reader re-checks the domain afterward, so archive your
evidence.

### Cost

Roughly **$20 per GB, once**, at the 150 sat/KB fee floor. No renewal, no account.
A typical source repo's full history lands between pennies and a few dollars.
`bgit publish` tells you the exact number before you spend anything.

### Other chain commands

```bash
bgit chain verify-vendor   # confirm the vendored format sources are unmodified
bgit chain spec            # print the on-chain format specification
bgit chain credits         # who wrote the on-chain format
```

### Broadcast providers

Publishing broadcasts through a bridge on your own loopback interface, which
forwards to, in order:

1. **WhatsOnChain** — no configuration needed
2. **GorillaPool ARC** — no configuration needed
3. **TAAL ARC** — *only tried if `TAAL_API_KEY` is set*

TAAL rejects unauthenticated requests with `401`, so it is skipped unless you
provide a key. Set it in `.env.local` if you want the third fallback:

```
TAAL_API_KEY=your-taal-key
```

Pass `--bridge <url>` to bypass the local bridge and use your own endpoint; it
must accept `POST {"rawTx":"<hex>"}`.

---

## Quick Start

### Installation

```bash
# Install globally
npm install -g bgit-cli

# Verify installation
bgit --version
```

### First-Time Setup

```bash
# Authenticate with HandCash (opens browser)
bgit auth login

# Check authentication status
bgit auth status
```

### Use It Like Git

```bash
# Free commands (no payment)
bgit status
bgit log
bgit diff

# Paid commands (0.001 BSV each)
bgit commit -m "Initial commit"  # ← Timestamps commit hash on-chain
bgit push origin main            # ← Payment required before push
```

---

## Payment Model

bgit uses a **minimal payment model** for maximum usability:

### 🆓 Free Commands

All **read-only** operations are FREE:
- `bgit status` - Check working tree
- `bgit log` - View commit history
- `bgit diff` - See changes
- `bgit show` - Inspect commits
- `bgit branch` - List branches
- ... and 150+ other read commands

### 💰 Paid Commands (0.001 BSV each)

Only **"publishing"** operations require payment:
- `bgit commit` - Create commit + timestamp hash on-chain
- `bgit push` - Payment gatekeeper before push

**Why this model?** Developers run status/log hundreds of times per day. Paying for reads would cost $10-50/day. Commits/pushes are "publishing" events worth timestamping.

### 🔧 Universal Mode (Optional)

Enable payment for ALL 155 git commands:

```bash
# Enable universal mode
bgit config payment-mode universal

# Now EVERY command requires payment
bgit status  # ← Costs 0.001 BSV
bgit log     # ← Costs 0.001 BSV

# Switch back to minimal
bgit config payment-mode minimal
```

---

## Authentication

### OAuth Flow

1. Run `bgit auth login`
2. Browser opens to HandCash authorization page
3. Click "Authorize" to connect your wallet
4. Token is encrypted and saved locally
5. All future commands use saved token

### Auth Commands

```bash
bgit auth login    # Authenticate with HandCash
bgit auth status   # Show auth status + wallet balance
bgit auth logout   # Delete credentials
```

### Security Features

- **AES-256-GCM Encryption** - Bank-grade token encryption
- **Machine-Specific Key** - Token only works on your machine
- **File Permissions** - 600 (config), 700 (directory)
- **No Token Logging** - Tokens never appear in logs

---

## How It Works

### Commit Flow

```bash
bgit commit -m "Add feature"

# What happens:
# 1. Execute git commit FIRST
# 2. Capture commit hash (abc123...)
# 3. Send 0.001 BSV payment to $b0ase
# 4. Payment note: "bgit commit: abc123..."
# 5. ✅ Commit hash timestamped on BitcoinSV!
```

### Money Flow

```
Your HandCash Wallet
    ↓
0.001 BSV (developer premium) + 0.00001 BSV (network fee)
    ↓
    ├──→ 0.001 BSV → $b0ase (developer)
    └──→ 0.00001 BSV → BSV miners
```

---

## Configuration

```bash
# Show current payment mode
bgit config payment-mode

# Set to minimal (default: commit/push only)
bgit config payment-mode minimal

# Set to universal (all 155 commands)
bgit config payment-mode universal
```

**Config Location:** `~/.bgit/config.json`

---

## Examples

### Daily Workflow

```bash
# Check status (free)
bgit status

# Work on code
bgit checkout -b new-feature
bgit add src/

# Commit (paid: 0.001 BSV)
bgit commit -m "Implement feature"

# Push (paid: 0.001 BSV)
bgit push origin new-feature
```

**Total cost:** 0.002 BSV (~$0.10)

---

## FAQ

**Q: Why only commit/push by default?**
A: Usability. Developers run status/log 100+ times/day. Charging for reads kills adoption. Commits/pushes are publishing events worth timestamping.

**Q: How much does it cost?**
A: Minimal mode: ~$0.50-1/day for typical developer (10-20 commits). Universal mode: $2.50-25/day depending on usage.

**Q: Where do payments go?**
A: Developer wallet ($b0ase). This is revenue for maintaining bgit.

**Q: Is my token secure?**
A: Yes. AES-256-GCM encryption with machine-specific key. File permissions 600.

**Q: What if payment fails?**
A: Commits succeed, payment failure is warned. Pushes are blocked until payment succeeds.

---

## Requirements

- **Node.js:** >= 18.0.0 (the on-chain commands need global `fetch`)
- **Git:** Any version
- **HandCash Account:** https://handcash.io — for `commit` / `push` only
- **BSV Funds:**
  - `commit` / `push`: at least 0.01 BSV (~$0.50) in HandCash
  - `publish`: a funded raw key; cost scales with repo size (~$20/GB, once)

---

## Troubleshooting

**"No auth token found"**
```bash
bgit auth login
```

**"Insufficient balance"**
Add funds at https://handcash.io

**"Config corrupted"**
```bash
rm -rf ~/.bgit/
bgit auth login
```

**"No publishing key found"**
Publishing does not use HandCash. Generate a raw key:
```bash
bgit chain keygen --out publisher-key.json
```

**"Insufficient funding at <address>" despite having a balance**
Publishing chains change from one transaction into the next, so it needs a *single*
UTXO covering the whole run, not a sufficient total. Consolidate your UTXOs.

**"Vendored sources have DRIFTED from upstream"**
`lib/chain/` implements an on-chain format that cannot be patched after the fact.
Do not edit those files — restore them and see `lib/chain/UPSTREAM.md`.

---

## Development

```bash
# Clone
git clone https://github.com/bitcoin-apps-suite/bgit.git
cd bgit

# Install (pnpm — never npm or yarn)
pnpm install

# Run the on-chain format's own test vectors
pnpm test

# Verify vendored sources are unmodified
pnpm run verify-vendor

# Try it without spending anything
node index.js publish            # dry run: cost estimate only
```

**Known:** `pnpm test` reports 29/30 on macOS. Vector 7b fails because of a
symlink-vs-realpath bug in upstream's CLI entry detection (`/tmp` → `/private/tmp`),
not a defect in the format — the corruption detection it tests is verified working.
Full diagnosis in [`lib/chain/UPSTREAM.md`](./lib/chain/UPSTREAM.md).

---

## Credits

The on-chain repository format — publisher, reader, claim mechanism, specification,
and test vectors — is the work of **Ryan Bennett ([zcoolz](https://github.com/zcoolz))**,
from [github.com/zcoolz/bgit](https://github.com/zcoolz/bgit), used under the MIT
license and vendored **unmodified** at [`lib/chain/`](./lib/chain/).

That format survived three adversarial review rounds by OpenAI's Codex against a
Claude-built design before its first broadcast, and ships its own audit record. We
did not reimplement it, and deliberately do not edit it — see
[`lib/chain/UPSTREAM.md`](./lib/chain/UPSTREAM.md) for why, and
[`NOTICE`](./NOTICE) for full attribution.

The BSV funding and broadcast layer is ported from
[b0ase/bitgit](https://github.com/b0ase/bitgit) (Open BSV License).

---

## License

ISC for bgit itself. Vendored and ported components retain their own licenses —
see [`NOTICE`](./NOTICE).

---

## Links

- **GitHub:** https://github.com/bitcoin-apps-suite/bgit
- **HandCash:** https://handcash.io
- **Issues:** https://github.com/bitcoin-apps-suite/bgit/issues
- **Format spec:** [`lib/chain/SPEC.md`](./lib/chain/SPEC.md)
- **Upstream format:** https://github.com/zcoolz/bgit

---

**Made with ❤️ for the Bitcoin developer community**

Timestamp your code. Prove your work. Build on BSV.
test retry 3
