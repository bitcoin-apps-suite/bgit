/**
 * bgit Token Manager
 *
 * Manages HandCash auth token lifecycle including validation and caching.
 * Validates tokens against HandCash API with 1-hour cache to minimize API calls.
 *
 * Features:
 * - Token validation via HandCash API
 * - 1-hour validation cache (reduces API calls)
 * - Automatic re-auth trigger on invalid/expired tokens
 */

const { HandCashConnect } = require('@handcash/handcash-connect');
const { HANDCASH_APP_ID, HANDCASH_APP_SECRET, TOKEN_VALIDATION_CACHE_TTL_MS } = require('./constants');

// Validation cache: { token: { valid: boolean, timestamp: number } }
const validationCache = new Map();

/**
 * Check if cached validation is still valid (within TTL)
 *
 * @param {string} authToken - Token to check cache for
 * @returns {boolean|null} true if valid, false if invalid, null if no cache
 */
function getCachedValidation(authToken) {
  if (!validationCache.has(authToken)) {
    return null;
  }

  const cached = validationCache.get(authToken);
  const age = Date.now() - cached.timestamp;

  if (age > TOKEN_VALIDATION_CACHE_TTL_MS) {
    // Cache expired
    validationCache.delete(authToken);
    return null;
  }

  return cached.valid;
}

/**
 * Cache token validation result
 *
 * @param {string} authToken - Token to cache
 * @param {boolean} valid - Whether token is valid
 */
function setCachedValidation(authToken, valid) {
  validationCache.set(authToken, {
    valid,
    timestamp: Date.now()
  });
}

/**
 * Clear validation cache
 * Useful after re-authentication
 */
function clearValidationCache() {
  validationCache.clear();
}

/**
 * Validate auth token against HandCash API
 * Uses cached result if available (1-hour TTL)
 *
 * @param {string} authToken - HandCash auth token to validate
 * @returns {Promise<boolean>} true if valid, false otherwise
 */
async function isTokenValid(authToken) {
  if (!authToken || typeof authToken !== 'string') {
    return false;
  }

  // Check cache first
  const cached = getCachedValidation(authToken);
  if (cached !== null) {
    return cached;
  }

  try {
    const handCashConnect = new HandCashConnect({
      appId: HANDCASH_APP_ID,
      appSecret: HANDCASH_APP_SECRET
    });

    const account = handCashConnect.getAccountFromAuthToken(authToken);

    // Try to get profile - this validates the token
    const profile = await account.profile.getCurrentProfile();

    if (profile && profile.publicProfile && profile.publicProfile.handle) {
      // Token is valid
      setCachedValidation(authToken, true);
      return true;
    } else {
      // Unexpected response
      setCachedValidation(authToken, false);
      return false;
    }
  } catch (error) {
    // Token is invalid or API error
    setCachedValidation(authToken, false);
    return false;
  }
}

/**
 * Get HandCash account profile
 * Used to display auth status
 *
 * @param {string} authToken - HandCash auth token
 * @returns {Promise<Object|null>} Profile object or null if error
 */
async function getProfile(authToken) {
  try {
    const handCashConnect = new HandCashConnect({
      appId: HANDCASH_APP_ID,
      appSecret: HANDCASH_APP_SECRET
    });

    const account = handCashConnect.getAccountFromAuthToken(authToken);
    const profile = await account.profile.getCurrentProfile();

    return profile;
  } catch (error) {
    console.error(`Failed to get profile: ${error.message}`);
    return null;
  }
}

/**
 * Get HandCash account balance
 * Used to check if user has sufficient funds
 *
 * @param {string} authToken - HandCash auth token
 * @returns {Promise<Object|null>} Balance object or null if error
 */
async function getBalance(authToken) {
  try {
    const handCashConnect = new HandCashConnect({
      appId: HANDCASH_APP_ID,
      appSecret: HANDCASH_APP_SECRET
    });

    const account = handCashConnect.getAccountFromAuthToken(authToken);
    const spendableBalance = await account.wallet.getSpendableBalance();

    return spendableBalance;
  } catch (error) {
    console.error(`Failed to get balance: ${error.message}`);
    return null;
  }
}

/**
 * Check if token should be refreshed
 * HandCash tokens don't expire, but this provides a hook for future refresh logic
 *
 * @param {string} authToken - HandCash auth token
 * @returns {Promise<boolean>} true if token should be refreshed
 */
async function shouldRefresh(authToken) {
  // HandCash Connect SDK doesn't currently support token refresh
  // Tokens are long-lived and don't expire
  // This function is a placeholder for future enhancement
  return false;
}

module.exports = {
  isTokenValid,
  getProfile,
  getBalance,
  shouldRefresh,
  clearValidationCache,
  getCachedValidation,
  setCachedValidation
};
