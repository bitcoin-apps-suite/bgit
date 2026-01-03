# bgit

**bgit** is a Bitcoin-enabled wrapper for Git. It integrates micro-payments into your development workflow, enforcing a "Pay to Commit" model using HandCash on BitcoinSV.

## Features

*   **Pay to Commit**: Automatically prompts for a micro-payment (e.g., $0.0001) before allowing a `git commit`.
*   **Pay to Push**: Ensures contributions are incentivized or gated by payments on `git push`.
*   **Seamless Integration**: Passes all other commands transparently to the standard `git` executable.
*   **HandCash Connect**: Utilizes the HandCash SDK for secure, user-friendly payments.

## Installation

```bash
npm install -g bgit
```

## Usage

Use `bgit` exactly as you would use `git`.

```bash
# Initialize a repo (free)
bgit init

# Check status (free)
bgit status

# Commit changes (Triggers Payment)
bgit commit -m "feat: added new payment logic"

# Push changes (Triggers Payment)
bgit push origin main
```

## Configuration

To use `bgit`, you must have a HandCash Connect App ID and Secret.

Create a `.bgitrc` file or set environment variables:

```bash
export HANDCASH_APP_ID="your_app_id"
export HANDCASH_APP_SECRET="your_app_secret"
```

## License

MIT
