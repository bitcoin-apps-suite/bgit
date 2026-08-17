#!/usr/bin/env node

/**
 * bgit - Bitcoin-enabled Git wrapper
 *
 * Usage:
 *   bgit <git-command> [args...]  - Execute git command with optional payment
 *   bgit auth login               - Authenticate with HandCash
 *   bgit auth logout              - Log out and delete credentials
 *   bgit auth status              - Show authentication status
 *
 * Payment-gated commands: commit, push
 * All other git commands pass through without payment
 */

// Load HANDCASH_APP_SECRET (and any other vars) from .env.local before anything
// reads process.env — the secret is no longer hardcoded (see lib/constants.js).
require('./lib/load-env').loadEnv();

const chalk = require('chalk');
const showBanner = require('./lib/banner');
const { ensureAuthenticated, loginCommand, logoutCommand, statusCommand } = require('./lib/auth');
const { routeCommand, needsAuthentication } = require('./lib/command-router');
const { getPaymentMode, setPaymentMode } = require('./lib/config');
const { CHAIN_COMMANDS, routeChainCommand } = require('./lib/chain-commands');

async function main() {
  try {
    // Parse command-line arguments
    const args = process.argv.slice(2);

    if (args.length === 0) {
      // No arguments - show help
      showHelp();
      process.exit(0);
    }

    const command = args[0];
    const subcommand = args[1];

    // `--version` must report bgit's version, not git's. Without this it falls
    // through to the pass-through router and prints `git version …`, which the
    // README's "verify installation" step relies on being bgit's. The bare
    // `version` subcommand still passes through to git, as a git wrapper should.
    if (command === '--version' || command === '-v') {
      console.log(`bgit ${require('./package.json').version}`);
      process.exit(0);
    }

    // Show banner for git commands (not auth/config/chain subcommands)
    if (command !== 'auth' && command !== 'config' && !CHAIN_COMMANDS.has(command)) {
      showBanner();
    }

    // On-chain repository commands (publish / reconstruct / claim / chain).
    // These use a raw BSV key, not HandCash — see lib/funding.js for why.
    if (CHAIN_COMMANDS.has(command)) {
      const exitCode = await routeChainCommand(command, args.slice(1));
      process.exit(exitCode);
    }

    // Handle special 'auth' commands
    if (command === 'auth') {
      if (subcommand === 'login') {
        await loginCommand();
        process.exit(0);
      } else if (subcommand === 'logout') {
        await logoutCommand();
        process.exit(0);
      } else if (subcommand === 'status') {
        await statusCommand();
        process.exit(0);
      } else {
        console.error(chalk.red(`Unknown auth command: ${subcommand}`));
        console.log(chalk.gray('\nAvailable auth commands:'));
        console.log(chalk.gray('  bgit auth login   - Authenticate with HandCash'));
        console.log(chalk.gray('  bgit auth logout  - Log out and delete credentials'));
        console.log(chalk.gray('  bgit auth status  - Show authentication status\n'));
        process.exit(1);
      }
    }

    // Handle special 'config' commands
    if (command === 'config') {
      if (subcommand === 'payment-mode') {
        const mode = args[2]; // 'minimal' or 'universal'

        if (!mode) {
          // Show current mode
          const current = getPaymentMode();
          console.log(chalk.blue.bold('\n💰 Payment Mode Configuration\n'));
          console.log(`Current mode: ${chalk.cyan(current)}\n`);
          console.log(chalk.bold('Available modes:'));
          console.log(chalk.gray('  minimal    - Only commit/push require payment (default)'));
          console.log(chalk.gray('  universal  - All 155 git commands require payment\n'));
          console.log(chalk.bold('Usage:'));
          console.log(chalk.gray('  bgit config payment-mode <mode>\n'));
          console.log(chalk.bold('Examples:'));
          console.log(chalk.gray('  bgit config payment-mode minimal'));
          console.log(chalk.gray('  bgit config payment-mode universal\n'));
          process.exit(0);
        }

        // Set mode
        try {
          setPaymentMode(mode);
          process.exit(0);
        } catch (error) {
          console.error(chalk.red(`\n❌ ${error.message}\n`));
          process.exit(1);
        }
      } else {
        console.error(chalk.red(`Unknown config command: ${subcommand}`));
        console.log(chalk.gray('\nAvailable config commands:'));
        console.log(chalk.gray('  bgit config payment-mode  - Configure payment mode\n'));
        process.exit(1);
      }
    }

    // For git commands, check if authentication is needed
    let authToken = null;

    if (needsAuthentication(command)) {
      // Payment-gated command - ensure authenticated
      authToken = await ensureAuthenticated();
    }

    // Route to appropriate git command handler
    const exitCode = await routeCommand(args, authToken);
    process.exit(exitCode);
  } catch (error) {
    console.error(chalk.red(`\n❌ Error: ${error.message}\n`));

    // Show helpful hints for common errors
    if (error.message.includes('authentication') || error.message.includes('token')) {
      console.log(chalk.gray('Try running: bgit auth login\n'));
    } else if (error.message.includes('payment') || error.message.includes('balance')) {
      console.log(chalk.gray('Add funds to your HandCash wallet: https://handcash.io\n'));
    }

    process.exit(1);
  }
}

/**
 * Show help message
 */
function showHelp() {
  console.log(chalk.blue.bold('\nbgit - Bitcoin-enabled Git wrapper\n'));
  console.log(chalk.bold('Usage:'));
  console.log('  bgit <git-command> [args...]  Execute git command with optional payment');
  console.log('  bgit auth <subcommand>        Manage authentication');
  console.log('  bgit publish|reconstruct      Store / recover whole repositories on-chain\n');

  console.log(chalk.bold('Authentication Commands:'));
  console.log('  bgit auth login               Authenticate with HandCash');
  console.log('  bgit auth logout              Log out and delete credentials');
  console.log('  bgit auth status              Show authentication status\n');

  console.log(chalk.bold('Payment-Gated Commands:') + chalk.gray('  (HandCash wallet)'));
  console.log('  bgit commit                   Git commit + on-chain timestamp (0.001 BSV)');
  console.log('  bgit push                     Git push + payment (0.001 BSV)\n');

  console.log(chalk.bold('On-Chain Repository Commands:') + chalk.gray('  (raw BSV key — not HandCash)'));
  console.log('  bgit publish                  Publish full repo history to BSV (dry run by default)');
  console.log('  bgit publish --broadcast      Publish for real, after showing the cost');
  console.log('  bgit publish --confirm        Check which transactions have been mined');
  console.log('  bgit reconstruct --repo-id X  Rebuild a repo from chain into a clonable bundle');
  console.log('  bgit verify --repo-id X       Check a bundle you HAVE against its commitment');
  console.log('  bgit claim --repo-id X        Claim an unsigned mirror you maintain');
  console.log('  bgit chain keygen             Generate a publishing key');
  console.log('  bgit chain verify-vendor      Verify vendored format sources');
  console.log('  bgit chain spec               Print the on-chain format specification');
  console.log('  bgit chain credits            Who wrote the on-chain format\n');
  console.log(chalk.gray('  The on-chain format is Ryan Bennett\'s work (github.com/zcoolz/bgit, MIT),'));
  console.log(chalk.gray('  vendored unmodified. Not ours — see `bgit chain credits`.\n'));

  console.log(chalk.bold('Pass-Through Commands:'));
  console.log('  All other git commands work without payment (status, log, diff, etc.)\n');

  console.log(chalk.bold('Examples:'));
  console.log(chalk.gray('  bgit auth login                         # First-time setup'));
  console.log(chalk.gray('  bgit commit -m "Initial commit"         # Commit + timestamp'));
  console.log(chalk.gray('  bgit push origin main                   # Push with payment'));
  console.log(chalk.gray('  bgit status                             # Free, no payment'));
  console.log(chalk.gray('  bgit publish                            # Cost estimate, spends nothing'));
  console.log(chalk.gray('  bgit publish --broadcast                # Publish history to BSV'));
  console.log(chalk.gray('  bgit reconstruct --repo-id 1ABC...      # Recover a repo from chain\n'));

  console.log(chalk.bold('Learn More:'));
  console.log('  GitHub: https://github.com/bitcoin-apps-suite/bgit');
  console.log('  HandCash: https://handcash.io\n');
}

// Run main function
main();
