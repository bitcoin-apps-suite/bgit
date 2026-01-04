/**
 * bgit Configuration Management
 *
 * Manages encrypted token storage in ~/.bgit/config.json
 * Uses machine-specific encryption key derived from hostname + username
 *
 * Security features:
 * - Machine-specific encryption (token only works on same machine)
 * - File permissions: 700 for directory, 600 for files
 * - Random salt per machine
 * - Automatic config validation and repair
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { generateSalt, deriveKey, encrypt, decrypt } = require('./crypto');
const {
  CONFIG_DIR_NAME,
  CONFIG_FILE_NAME,
  SALT_FILE_NAME,
  DIR_PERMISSIONS,
  FILE_PERMISSIONS
} = require('./constants');

/**
 * Get the config directory path (~/.bgit)
 * @returns {string} Absolute path to config directory
 */
function getConfigDir() {
  return path.join(os.homedir(), CONFIG_DIR_NAME);
}

/**
 * Get the config file path (~/.bgit/config.json)
 * @returns {string} Absolute path to config file
 */
function getConfigPath() {
  return path.join(getConfigDir(), CONFIG_FILE_NAME);
}

/**
 * Get the salt file path (~/.bgit/.salt)
 * @returns {string} Absolute path to salt file
 */
function getSaltPath() {
  return path.join(getConfigDir(), SALT_FILE_NAME);
}

/**
 * Ensure config directory exists with correct permissions
 * Creates directory if it doesn't exist
 * @throws {Error} If directory creation fails
 */
function ensureConfigDir() {
  const configDir = getConfigDir();

  try {
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { mode: DIR_PERMISSIONS, recursive: true });
      console.log(`Created config directory: ${configDir}`);
    }

    // Verify and fix permissions if needed
    const stats = fs.statSync(configDir);
    const currentMode = stats.mode & 0o777;

    if (currentMode !== DIR_PERMISSIONS) {
      fs.chmodSync(configDir, DIR_PERMISSIONS);
      console.warn(`Fixed config directory permissions: ${configDir}`);
    }
  } catch (error) {
    throw new Error(`Failed to create config directory: ${error.message}`);
  }
}

/**
 * Generate machine-specific identifier
 * Combines hostname and username for uniqueness
 * @returns {string} SHA-256 hash of machine identifiers
 */
function getMachineId() {
  try {
    const hostname = os.hostname();
    const username = os.userInfo().username;

    return crypto.createHash('sha256')
      .update(hostname)
      .update(username)
      .digest('hex');
  } catch (error) {
    throw new Error(`Failed to generate machine ID: ${error.message}`);
  }
}

/**
 * Get or create encryption key for this machine
 * Key is derived from machine ID + salt using PBKDF2
 * @returns {Buffer} 32-byte encryption key
 * @throws {Error} If key generation fails
 */
function getMachineKey() {
  ensureConfigDir();
  const saltPath = getSaltPath();

  let salt;

  try {
    if (fs.existsSync(saltPath)) {
      // Load existing salt
      salt = fs.readFileSync(saltPath);

      if (salt.length !== 32) {
        throw new Error('Invalid salt file (corrupted)');
      }
    } else {
      // Generate new salt
      salt = generateSalt();
      fs.writeFileSync(saltPath, salt, { mode: FILE_PERMISSIONS });
      console.log(`Generated encryption salt: ${saltPath}`);
    }

    // Verify salt file permissions
    const stats = fs.statSync(saltPath);
    const currentMode = stats.mode & 0o777;

    if (currentMode !== FILE_PERMISSIONS) {
      fs.chmodSync(saltPath, FILE_PERMISSIONS);
      console.warn(`Fixed salt file permissions: ${saltPath}`);
    }

    // Derive key from machine ID + salt
    const machineId = getMachineId();
    return deriveKey(machineId, salt);
  } catch (error) {
    throw new Error(`Failed to get machine key: ${error.message}`);
  }
}

/**
 * Save auth token to encrypted config file
 * @param {string} authToken - HandCash auth token to save
 * @throws {Error} If save fails
 */
function saveToken(authToken) {
  if (!authToken || typeof authToken !== 'string') {
    throw new Error('Auth token must be a non-empty string');
  }

  ensureConfigDir();

  try {
    const key = getMachineKey();
    const encrypted = encrypt(authToken, key);

    const config = {
      version: '2.0',
      encrypted: encrypted,
      createdAt: new Date().toISOString(),
      machineId: getMachineId() // Store for validation
    };

    const configPath = getConfigPath();
    fs.writeFileSync(
      configPath,
      JSON.stringify(config, null, 2),
      { mode: FILE_PERMISSIONS }
    );

    console.log(`✓ Token saved securely to: ${configPath}`);
  } catch (error) {
    throw new Error(`Failed to save token: ${error.message}`);
  }
}

/**
 * Load and decrypt auth token from config file
 * @returns {string|null} Decrypted auth token, or null if no config exists
 * @throws {Error} If config is corrupted or decryption fails
 */
function loadToken() {
  const configPath = getConfigPath();

  if (!fs.existsSync(configPath)) {
    return null; // No token saved yet
  }

  try {
    // Read config file
    const configData = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(configData);

    // Validate config structure
    if (!config.encrypted || !config.machineId) {
      throw new Error('Config file is corrupted (missing required fields)');
    }

    // Verify machine ID matches
    const currentMachineId = getMachineId();
    if (config.machineId !== currentMachineId) {
      console.warn('Warning: Config was created on a different machine');
      console.warn('This may cause decryption to fail');
    }

    // Decrypt token
    const key = getMachineKey();
    const authToken = decrypt(config.encrypted, key);

    return authToken;
  } catch (error) {
    if (error.message.includes('tampered')) {
      throw new Error('Config file has been tampered with. Please re-authenticate.');
    }
    if (error.message.includes('JSON')) {
      throw new Error('Config file is corrupted. Please re-authenticate.');
    }
    throw new Error(`Failed to load token: ${error.message}`);
  }
}

/**
 * Delete config file (logout)
 * @returns {boolean} true if config was deleted, false if it didn't exist
 */
function deleteToken() {
  const configPath = getConfigPath();

  if (fs.existsSync(configPath)) {
    try {
      fs.unlinkSync(configPath);
      console.log(`✓ Token deleted: ${configPath}`);
      return true;
    } catch (error) {
      throw new Error(`Failed to delete token: ${error.message}`);
    }
  }

  return false;
}

/**
 * Check if auth token exists
 * @returns {boolean} true if config file exists
 */
function hasToken() {
  return fs.existsSync(getConfigPath());
}

/**
 * Validate config file integrity
 * Checks file permissions and structure
 * @returns {Object} Validation result with issues array
 */
function validateConfig() {
  const configPath = getConfigPath();
  const issues = [];

  if (!fs.existsSync(configPath)) {
    return { valid: true, issues: [] }; // No config is valid
  }

  try {
    // Check file permissions
    const stats = fs.statSync(configPath);
    const currentMode = stats.mode & 0o777;

    if (currentMode !== FILE_PERMISSIONS) {
      issues.push(`Insecure file permissions: ${currentMode.toString(8)} (should be 600)`);
    }

    // Check file structure
    const configData = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(configData);

    if (!config.version) {
      issues.push('Missing version field');
    }

    if (!config.encrypted || !config.encrypted.ciphertext || !config.encrypted.iv || !config.encrypted.authTag) {
      issues.push('Missing or incomplete encrypted data');
    }

    if (!config.machineId) {
      issues.push('Missing machine ID');
    }

    return {
      valid: issues.length === 0,
      issues
    };
  } catch (error) {
    return {
      valid: false,
      issues: [`Config validation failed: ${error.message}`]
    };
  }
}

/**
 * Repair config file issues
 * Fixes file permissions and recreates config if corrupted
 * @returns {boolean} true if repairs were made
 */
function repairConfig() {
  const configPath = getConfigPath();
  let repaired = false;

  if (!fs.existsSync(configPath)) {
    return false; // Nothing to repair
  }

  try {
    // Fix file permissions
    const stats = fs.statSync(configPath);
    const currentMode = stats.mode & 0o777;

    if (currentMode !== FILE_PERMISSIONS) {
      fs.chmodSync(configPath, FILE_PERMISSIONS);
      console.log(`✓ Fixed config file permissions`);
      repaired = true;
    }

    // Validate structure
    const validation = validateConfig();

    if (!validation.valid && validation.issues.some(issue => issue.includes('corrupted') || issue.includes('Missing'))) {
      console.warn('Config file is corrupted and cannot be repaired.');
      console.warn('Please run: bgit auth login');
      return false;
    }

    return repaired;
  } catch (error) {
    console.error(`Config repair failed: ${error.message}`);
    return false;
  }
}

/**
 * Payment mode configuration
 * Determines which git commands require payment
 */
const PAYMENT_MODES = {
  minimal: ['commit', 'push'],                    // Default: only publishing operations
  universal: require('./commands')                 // All 155 git commands
};

/**
 * Get current payment mode
 * @returns {string} Payment mode ('minimal' or 'universal')
 */
function getPaymentMode() {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return 'minimal'; // Default mode
  }

  try {
    const configData = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(configData);
    return config.paymentMode || 'minimal';
  } catch (error) {
    return 'minimal';
  }
}

/**
 * Set payment mode
 * @param {string} mode - 'minimal' or 'universal'
 * @throws {Error} If invalid mode
 */
function setPaymentMode(mode) {
  if (!PAYMENT_MODES[mode]) {
    throw new Error(`Invalid payment mode: ${mode}. Use 'minimal' or 'universal'`);
  }

  ensureConfigDir();
  const configPath = getConfigPath();

  let config = {};
  if (fs.existsSync(configPath)) {
    try {
      const configData = fs.readFileSync(configPath, 'utf8');
      config = JSON.parse(configData);
    } catch (error) {
      // If config is corrupted, start fresh
      config = {};
    }
  }

  config.paymentMode = mode;
  fs.writeFileSync(
    configPath,
    JSON.stringify(config, null, 2),
    { mode: FILE_PERMISSIONS }
  );

  console.log(`✓ Payment mode set to: ${mode}`);

  // Show helpful info
  if (mode === 'universal') {
    console.log('\n⚠️  Universal mode enabled - ALL git commands now require payment (0.001 BSV each)');
    console.log('This includes: status, log, diff, and all other commands.');
  } else {
    console.log('\n✓ Minimal mode - Only commit and push require payment');
    console.log('All read operations (status, log, diff, etc.) are FREE');
  }
}

/**
 * Get list of payment-gated commands for current mode
 * @returns {string[]} Array of command names
 */
function getPaymentGatedCommands() {
  const mode = getPaymentMode();
  return PAYMENT_MODES[mode];
}

module.exports = {
  getConfigDir,
  getConfigPath,
  getSaltPath,
  ensureConfigDir,
  getMachineId,
  getMachineKey,
  saveToken,
  loadToken,
  deleteToken,
  hasToken,
  validateConfig,
  repairConfig,
  // Payment mode functions
  getPaymentMode,
  setPaymentMode,
  getPaymentGatedCommands,
  PAYMENT_MODES
};
