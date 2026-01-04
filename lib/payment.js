/**
 * bgit Payment Gateway
 *
 * Handles BitcoinSV payments via HandCash for commit timestamps and pushes.
 * Enhanced with retry logic, error handling, and user-friendly messages.
 *
 * Features:
 * - Automatic retry with exponential backoff
 * - Pre-flight balance check (optional)
 * - Enhanced error messages
 * - Transaction logging
 * - Soft fail for git operations (git succeeds even if payment fails)
 */

const { HandCashConnect } = require('@handcash/handcash-connect');
const chalk = require('chalk');
const {
  HANDCASH_APP_ID,
  HANDCASH_APP_SECRET,
  TREASURY_HANDLE,
  PAYMENT_RETRY_MAX_ATTEMPTS,
  PAYMENT_RETRY_BASE_DELAY_MS,
  PAYMENT_RETRY_MAX_DELAY_MS
} = require('./constants');

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay
 * @param {number} attempt - Current attempt number (0-indexed)
 * @returns {number} Delay in milliseconds
 */
function getBackoffDelay(attempt) {
  const delay = PAYMENT_RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
  return Math.min(delay, PAYMENT_RETRY_MAX_DELAY_MS);
}

/**
 * Execute payment with retry logic
 *
 * @param {number} amount - Amount in BSV
 * @param {string} note - Payment description/note (e.g., "Commit: abc123")
 * @param {string} authToken - HandCash auth token
 * @param {Object} options - Additional options
 * @param {boolean} options.checkBalance - Whether to check balance before payment (default: false)
 * @param {number} options.maxRetries - Max retry attempts (default: 3)
 * @returns {Promise<Object>} Payment result with transactionId
 * @throws {Error} If payment fails after all retries
 */
async function executePayment(amount, note, authToken, options = {}) {
  const {
    checkBalance = false,
    maxRetries = PAYMENT_RETRY_MAX_ATTEMPTS
  } = options;

  if (!authToken) {
    throw new Error('Auth token is required for payment');
  }

  if (!amount || amount <= 0) {
    throw new Error('Payment amount must be greater than 0');
  }

  try {
    const handCashConnect = new HandCashConnect({
      appId: HANDCASH_APP_ID,
      appSecret: HANDCASH_APP_SECRET
    });

    const account = handCashConnect.getAccountFromAuthToken(authToken);

    // Optional: Pre-flight balance check
    if (checkBalance) {
      try {
        const balance = await account.wallet.getSpendableBalance();

        if (balance.bsv < amount) {
          throw new Error(
            `Insufficient balance. You have ${balance.bsv.toFixed(6)} BSV, but need ${amount} BSV.\n` +
            `Add funds at: ${chalk.cyan('https://handcash.io')}`
          );
        }
      } catch (balanceError) {
        // Don't fail payment if balance check fails, just warn
        console.warn(chalk.yellow(`Warning: Could not check balance - ${balanceError.message}`));
      }
    }

    // Payment parameters
    const paymentParameters = {
      description: note || 'bgit payment',
      payments: [
        {
          destination: TREASURY_HANDLE,
          currencyCode: 'BSV',
          sendAmount: amount
        }
      ]
    };

    // Retry logic with exponential backoff
    let lastError;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = await account.wallet.pay(paymentParameters);

        // Payment successful
        console.log(chalk.green(`✓ Payment sent! Transaction ID: ${result.transactionId}`));

        if (note) {
          console.log(chalk.gray(`  Note: ${note}`));
        }

        return result;
      } catch (error) {
        lastError = error;

        // Check if error is retryable
        const isRetryable = isRetryableError(error);

        if (!isRetryable || attempt === maxRetries - 1) {
          // Don't retry, throw error
          break;
        }

        // Retry with backoff
        const delay = getBackoffDelay(attempt);
        console.log(chalk.yellow(`⚠️  Payment attempt ${attempt + 1} failed, retrying in ${delay / 1000}s... (${attempt + 1}/${maxRetries})`));
        await sleep(delay);
      }
    }

    // All retries failed
    throw enhancePaymentError(lastError);
  } catch (error) {
    throw error;
  }
}

/**
 * Check if error is retryable
 * Network errors and timeouts are retryable
 * Insufficient balance and invalid tokens are not
 *
 * @param {Error} error - Error to check
 * @returns {boolean} true if error is retryable
 */
function isRetryableError(error) {
  const message = error.message.toLowerCase();

  // Retryable errors
  const retryableKeywords = [
    'network',
    'timeout',
    'econnrefused',
    'enotfound',
    'etimedout',
    'socket hang up'
  ];

  if (retryableKeywords.some(keyword => message.includes(keyword))) {
    return true;
  }

  // Non-retryable errors
  const nonRetryableKeywords = [
    'insufficient',
    'balance',
    'invalid token',
    'unauthorized',
    'forbidden'
  ];

  if (nonRetryableKeywords.some(keyword => message.includes(keyword))) {
    return false;
  }

  // Default: retry unknown errors
  return true;
}

/**
 * Enhance payment error with helpful user message
 *
 * @param {Error} error - Original error
 * @returns {Error} Enhanced error with user-friendly message
 */
function enhancePaymentError(error) {
  const message = error.message.toLowerCase();

  // Insufficient balance
  if (message.includes('insufficient') || message.includes('balance')) {
    return new Error(
      `Insufficient balance in your HandCash wallet.\n` +
      `Add funds at: ${chalk.cyan('https://handcash.io')}\n` +
      `Original error: ${error.message}`
    );
  }

  // Invalid auth
  if (message.includes('unauthorized') || message.includes('invalid token')) {
    return new Error(
      `Your authentication has expired.\n` +
      `Please run: ${chalk.cyan('bgit auth login')}\n` +
      `Original error: ${error.message}`
    );
  }

  // Network errors
  if (message.includes('network') || message.includes('timeout')) {
    return new Error(
      `Network error - please check your internet connection and try again.\n` +
      `Original error: ${error.message}`
    );
  }

  // API errors
  if (message.includes('api') || message.includes('handcash')) {
    return new Error(
      `HandCash API error - the service may be temporarily unavailable.\n` +
      `Please try again later.\n` +
      `Original error: ${error.message}`
    );
  }

  // Unknown error
  return new Error(`Payment failed: ${error.message}`);
}

/**
 * Format payment note for commit timestamp
 * Truncates to fit HandCash 25-char limit
 *
 * @param {string} commitHash - Git commit hash
 * @returns {string} Formatted note
 */
function formatCommitNote(commitHash) {
  const shortHash = commitHash.substring(0, 8); // 8 chars
  return `Commit: ${shortHash}`; // "Commit: abc12345" (16 chars)
}

/**
 * Format payment note for push
 * Truncates to fit HandCash 25-char limit
 *
 * @param {string} remote - Remote name
 * @param {string} branch - Branch name
 * @returns {string} Formatted note
 */
function formatPushNote(remote = 'origin', branch = 'main') {
  const note = `Push: ${branch}`;
  // Ensure we don't exceed 25 chars
  return note.substring(0, 25);
}

/**
 * Soft fail wrapper for payments
 * If payment fails, warn user but don't fail the git operation
 *
 * @param {Function} paymentFn - Payment function to execute
 * @param {string} operation - Operation name (e.g., "commit", "push")
 * @returns {Promise<boolean>} true if payment succeeded, false otherwise
 */
async function softFailPayment(paymentFn, operation) {
  try {
    await paymentFn();
    return true;
  } catch (error) {
    console.warn(chalk.yellow(`\n⚠️  ${operation} succeeded, but on-chain timestamp failed:`));
    console.warn(chalk.yellow(error.message));
    console.log(chalk.gray(`Your ${operation} was saved locally.`));
    console.log();
    return false;
  }
}

module.exports = {
  executePayment,
  formatCommitNote,
  formatPushNote,
  softFailPayment,
  isRetryableError,
  enhancePaymentError
};
