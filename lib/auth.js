/**
 * bgit Authentication Manager
 *
 * Orchestrates HandCash OAuth authentication flow.
 * Manages token lifecycle and user authentication state.
 *
 * Flow:
 * 1. Check for existing token
 * 2. If no token or invalid → trigger OAuth
 * 3. Start local OAuth server
 * 4. Open browser to HandCash
 * 5. Capture callback with token
 * 6. Encrypt and save token
 * 7. Validate token
 */

const { HandCashConnect } = require('@handcash/handcash-connect');
const open = require('open');
const chalk = require('chalk');
const { loadToken, saveToken, deleteToken, hasToken } = require('./config');
const { isTokenValid, getProfile, getBalance, clearValidationCache } = require('./token-manager');
const { startOAuthServer, stopOAuthServer } = require('./oauth-server');
const { HANDCASH_APP_ID, HANDCASH_APP_SECRET } = require('./constants');

/**
 * Ensure user is authenticated
 * Checks for existing valid token or triggers OAuth flow
 *
 * @param {boolean} silent - If true, don't show welcome messages
 * @returns {Promise<string>} Valid auth token
 * @throws {Error} If authentication fails
 */
async function ensureAuthenticated(silent = false) {
  try {
    // 1. Check for environment variable (injected by VS Code extension)
    if (process.env.HANDCASH_AUTH_TOKEN) {
      if (!silent) console.log(chalk.green('✓ Using verified credentials from environment'));
      return process.env.HANDCASH_AUTH_TOKEN;
    }

    // 2. Check for existing local token
    if (hasToken()) {
      const authToken = loadToken();

      if (authToken) {
        // Validate token
        const valid = await isTokenValid(authToken);

        if (valid) {
          return authToken; // Token is valid, proceed
        } else {
          console.log(chalk.yellow('⚠️  Your authentication has expired.'));
          console.log(chalk.yellow('Re-authenticating...\n'));
        }
      }
    }

    // No token or invalid → trigger OAuth
    if (!silent) {
      console.log(chalk.blue('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
      console.log(chalk.blue.bold('🚀 Welcome to bgit!'));
      console.log();
      console.log('bgit timestamps your commits on BitcoinSV using HandCash.');
      console.log('Let\'s set up your authentication...');
      console.log(chalk.blue('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
    }

    const authToken = await initiateOAuthFlow();
    return authToken;
  } catch (error) {
    throw new Error(`Authentication failed: ${error.message}`);
  }
}

/**
 * Initiate full OAuth authentication flow
 *
 * @returns {Promise<string>} Valid auth token
 * @throws {Error} If OAuth flow fails
 */
async function initiateOAuthFlow() {
  let server = null;

  try {
    console.log(chalk.cyan('Opening browser for HandCash authorization...'));

    // 1. Start OAuth callback server
    const serverPromise = startOAuthServer();

    // 2. Get HandCash redirect URL with wallet permissions
    const handCashConnect = new HandCashConnect({
      appId: HANDCASH_APP_ID,
      appSecret: HANDCASH_APP_SECRET
    });

    // Request wallet permissions for payments
    const redirectUrl = handCashConnect.getRedirectionUrl({
      permissions: ['pay', 'profile']
    });

    // 3. Open browser
    try {
      await open(redirectUrl);
      console.log(chalk.green('✓ Browser opened'));
    } catch (error) {
      console.log(chalk.yellow('\n⚠️  Unable to open browser automatically'));
      console.log(chalk.yellow('Please visit this URL to authorize:\n'));
      console.log(chalk.cyan(redirectUrl));
      console.log();
    }

    console.log(chalk.cyan('Waiting for authorization... ⏳\n'));

    // 4. Wait for callback
    const result = await serverPromise;
    const { authToken, server: srv } = result;
    server = srv;

    // 5. Validate token
    console.log(chalk.cyan('Validating token...'));
    const valid = await isTokenValid(authToken);

    if (!valid) {
      throw new Error('Received invalid token from HandCash');
    }

    // 6. Save encrypted token
    saveToken(authToken);
    clearValidationCache(); // Clear cache to force fresh validation next time

    // 7. Stop server
    await stopOAuthServer(server);

    console.log(chalk.green('✓ Authentication successful!'));
    console.log(chalk.green('✓ Credentials saved securely\n'));

    return authToken;
  } catch (error) {
    // Clean up server on error
    if (server) {
      try {
        await stopOAuthServer(server);
      } catch (stopError) {
        // Ignore cleanup errors
      }
    }

    throw error;
  }
}

/**
 * Handle `bgit auth login` command
 * Force re-authentication even if token exists
 *
 * @returns {Promise<void>}
 */
async function loginCommand() {
  try {
    console.log(chalk.blue.bold('\n🔐 bgit Authentication\n'));

    // Delete existing token
    if (hasToken()) {
      deleteToken();
      clearValidationCache();
      console.log(chalk.yellow('Cleared existing credentials'));
    }

    // Trigger OAuth
    await initiateOAuthFlow();

    console.log(chalk.green.bold('✓ Login successful!\n'));
  } catch (error) {
    console.error(chalk.red(`\n❌ Login failed: ${error.message}\n`));
    process.exit(1);
  }
}

/**
 * Handle `bgit auth logout` command
 * Delete saved token
 *
 * @returns {Promise<void>}
 */
async function logoutCommand() {
  try {
    console.log(chalk.blue.bold('\n🔓 bgit Logout\n'));

    if (!hasToken()) {
      console.log(chalk.yellow('You are not currently logged in'));
      console.log(chalk.gray('Run: bgit auth login\n'));
      return;
    }

    deleteToken();
    clearValidationCache();

    console.log(chalk.green('✓ Logged out successfully'));
    console.log(chalk.gray('Your commits are safe, but timestamping is now disabled'));
    console.log(chalk.gray('Run: bgit auth login\n'));
  } catch (error) {
    console.error(chalk.red(`\n❌ Logout failed: ${error.message}\n`));
    process.exit(1);
  }
}

/**
 * Handle `bgit auth status` command
 * Show authentication status and account info
 *
 * @returns {Promise<void>}
 */
async function statusCommand() {
  try {
    console.log(chalk.blue.bold('\n🔍 bgit Authentication Status\n'));

    if (!hasToken()) {
      console.log(chalk.yellow('Status: Not authenticated'));
      console.log(chalk.gray('Run: bgit auth login\n'));
      return;
    }

    const authToken = loadToken();
    console.log(chalk.cyan('Validating token...'));

    const valid = await isTokenValid(authToken);

    if (!valid) {
      console.log(chalk.red('Status: Invalid/expired token'));
      console.log(chalk.gray('Run: bgit auth login\n'));
      return;
    }

    console.log(chalk.green('✓ Status: Authenticated\n'));

    // Get profile info
    const profile = await getProfile(authToken);

    if (profile) {
      console.log(chalk.bold('Account Information:'));
      console.log(`  Handle: ${chalk.cyan('@' + (profile.publicProfile?.handle || 'N/A'))}`);
      console.log(`  Name: ${profile.publicProfile?.displayName || 'N/A'}`);

      if (profile.publicProfile?.avatarUrl) {
        console.log(`  Avatar: ${profile.publicProfile.avatarUrl}`);
      }

      console.log();
    }

    // Get balance
    const balance = await getBalance(authToken);

    if (balance) {
      console.log(chalk.bold('Wallet Balance:'));

      // HandCash returns balance per currency
      if (balance.bsv) {
        console.log(`  BSV: ${chalk.green(balance.bsv.toFixed(6))} BSV`);
      }

      if (balance.usd) {
        console.log(`  USD: ${chalk.green('$' + balance.usd.toFixed(2))}`);
      }

      console.log();
    }

    console.log(chalk.gray('Token is valid and ready for use\n'));
  } catch (error) {
    console.error(chalk.red(`\n❌ Status check failed: ${error.message}\n`));
    process.exit(1);
  }
}

module.exports = {
  ensureAuthenticated,
  initiateOAuthFlow,
  loginCommand,
  logoutCommand,
  statusCommand
};
