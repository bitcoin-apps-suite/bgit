/**
 * bgit Command Router
 *
 * Routes git commands to appropriate execution handlers:
 * - Payment-gated commands: commit, push
 * - Pass-through commands: all others (status, log, diff, etc.)
 *
 * Payment Logic:
 * - commit: Git commit FIRST, then timestamp hash on-chain
 * - push: Payment FIRST (gatekeeper), then git push
 */

const { spawn, execSync } = require('child_process');
const chalk = require('chalk');
const { executePayment, formatCommitNote, formatPushNote, softFailPayment } = require('./payment');
const { PAYMENT_AMOUNTS } = require('./constants');
const { getPaymentGatedCommands } = require('./config');

/**
 * Check if command requires payment
 * Uses configurable payment mode from config
 *
 * @param {string} command - Git command (e.g., "commit", "push", "status")
 * @returns {boolean} true if command requires payment
 */
function isPaymentGated(command) {
  const gatedCommands = getPaymentGatedCommands();
  return gatedCommands.includes(command);
}

/**
 * Execute git command directly (pass-through)
 *
 * @param {string[]} args - Git command arguments (excluding 'git')
 * @returns {Promise<number>} Exit code
 */
function executeGitCommand(args) {
  return new Promise((resolve) => {
    const gitProcess = spawn('git', args, { stdio: 'inherit' });

    gitProcess.on('close', (code) => {
      resolve(code);
    });

    gitProcess.on('error', (error) => {
      console.error(chalk.red(`Failed to execute git: ${error.message}`));
      resolve(1);
    });
  });
}

/**
 * Execute git commit with on-chain timestamp
 * Flow: git commit → get hash → pay for timestamp
 *
 * @param {string[]} args - Git command arguments
 * @param {string} authToken - HandCash auth token
 * @returns {Promise<number>} Exit code
 */
async function executeCommit(args, authToken) {
  // 1. Execute git commit first
  const exitCode = await executeGitCommand(args);

  if (exitCode !== 0) {
    // Commit failed, don't try to pay
    return exitCode;
  }

  // 2. Get the new commit hash
  let commitHash;
  try {
    commitHash = execSync('git rev-parse HEAD').toString().trim();
  } catch (error) {
    console.error(chalk.red(`Failed to get commit hash: ${error.message}`));
    return 0; // Commit succeeded, hash retrieval failed
  }

  console.log(chalk.blue(`\n🔗 Capturing commit hash: ${chalk.bold(commitHash)}`));
  console.log(chalk.blue('💰 Timestamping this commit on-chain...\n'));

  // 3. Pay for timestamp (soft fail - don't block if payment fails)
  await softFailPayment(
    async () => {
      await executePayment(
        PAYMENT_AMOUNTS.commit,
        formatCommitNote(commitHash),
        authToken
      );
      console.log(chalk.green.bold('✓ Commit timestamped on BitcoinSV!'));
    },
    'Commit'
  );

  return 0; // Commit succeeded
}

/**
 * Execute git push with payment gatekeeper
 * Flow: pay first → then git push
 *
 * @param {string[]} args - Git command arguments
 * @param {string} authToken - HandCash auth token
 * @returns {Promise<number>} Exit code
 */
async function executePush(args, authToken) {
  // Extract remote and branch from args if available
  let remote = 'origin';
  let branch = 'main';

  // args might be ['push', 'origin', 'main'] or just ['push']
  if (args.length > 1) {
    remote = args[1];
  }
  if (args.length > 2) {
    branch = args[2];
  }

  console.log(chalk.blue(`\n💰 Payment required to push to ${remote}/${branch}...`));

  // 1. Pay first (gatekeeper)
  try {
    await executePayment(
      PAYMENT_AMOUNTS.push,
      formatPushNote(remote, branch),
      authToken
    );
    console.log(chalk.green('✓ Payment successful! Executing push...\n'));
  } catch (error) {
    // Payment failed - block the push
    console.error(chalk.red(`\n❌ Payment failed: ${error.message}`));
    console.error(chalk.red('Push cancelled. Please resolve the issue and try again.\n'));
    return 1;
  }

  // 2. Execute git push
  const exitCode = await executeGitCommand(args);

  if (exitCode === 0) {
    console.log(chalk.green.bold('\n✓ Push completed and payment recorded on BitcoinSV!'));
  } else {
    console.warn(chalk.yellow('\n⚠️  Push failed, but payment was already processed.'));
  }

  return exitCode;
}

/**
 * Route command to appropriate handler
 *
 * @param {string[]} args - Git command arguments (e.g., ['commit', '-m', 'message'])
 * @param {string} authToken - HandCash auth token (required for payment-gated commands)
 * @returns {Promise<number>} Exit code
 */
async function routeCommand(args, authToken) {
  if (!args || args.length === 0) {
    console.error(chalk.red('No git command specified'));
    return 1;
  }

  const command = args[0];

  // Route to appropriate handler
  if (command === 'commit') {
    return await executeCommit(args, authToken);
  } else if (command === 'push') {
    return await executePush(args, authToken);
  } else {
    // Pass through to git
    return await executeGitCommand(args);
  }
}

/**
 * Check if command needs authentication
 * Only payment-gated commands need auth
 *
 * @param {string} command - Git command
 * @returns {boolean} true if auth is required
 */
function needsAuthentication(command) {
  return isPaymentGated(command);
}

module.exports = {
  isPaymentGated,
  needsAuthentication,
  routeCommand,
  executeGitCommand,
  executeCommit,
  executePush
};
