# bgit - Bitcoin-Enabled Git Wrapper

**Version:** 2.0.0
**Timestamp your commits on BitcoinSV blockchain using HandCash OAuth**

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

## What is bgit?

bgit is a Git wrapper that timestamps your commits on the **BitcoinSV blockchain** using **HandCash** micropayments. Every commit you make gets a cryptographically provable timestamp on-chain, creating an immutable record of your code history.

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

- **Node.js:** >= 16.0.0
- **Git:** Any version
- **HandCash Account:** https://handcash.io
- **BSV Funds:** At least 0.01 BSV (~$0.50)

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

---

## Development

```bash
# Clone
git clone https://github.com/yourusername/bgit.git
cd bgit

# Install
npm install

# Test
./index.js auth login
./index.js commit -m "test"
```

---

## License

ISC

---

## Links

- **GitHub:** https://github.com/bitcoin-apps-suite/bgit
- **HandCash:** https://handcash.io
- **Issues:** https://github.com/bitcoin-apps-suite/bgit/issues

---

**Made with ❤️ for the Bitcoin developer community**

Timestamp your code. Prove your work. Build on BSV.
test
test: verify payment flow Sun Jan  4 02:04:57 GMT 2026
test retry 2
