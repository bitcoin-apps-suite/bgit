/**
 * bgit Cryptography Module
 *
 * Provides AES-256-GCM authenticated encryption for secure token storage.
 * Uses PBKDF2 for key derivation with 100,000 iterations.
 *
 * Security features:
 * - AES-256-GCM (authenticated encryption prevents tampering)
 * - Random IV per encryption (prevents pattern analysis)
 * - PBKDF2 key derivation (prevents brute force attacks)
 * - Authentication tag (detects any modifications)
 */

const crypto = require('crypto');
const {
  CRYPTO_ALGORITHM,
  CRYPTO_KEY_LENGTH,
  CRYPTO_IV_LENGTH,
  CRYPTO_SALT_LENGTH,
  CRYPTO_TAG_LENGTH,
  CRYPTO_PBKDF2_ITERATIONS
} = require('./constants');

/**
 * Generate a cryptographically random salt
 * @returns {Buffer} 32-byte random salt
 */
function generateSalt() {
  return crypto.randomBytes(CRYPTO_SALT_LENGTH);
}

/**
 * Derive encryption key from password and salt using PBKDF2
 * @param {string|Buffer} password - Password or machine ID
 * @param {Buffer} salt - Salt for key derivation
 * @returns {Buffer} 32-byte encryption key
 */
function deriveKey(password, salt) {
  try {
    const passwordBuffer = Buffer.isBuffer(password)
      ? password
      : Buffer.from(password, 'utf8');

    return crypto.pbkdf2Sync(
      passwordBuffer,
      salt,
      CRYPTO_PBKDF2_ITERATIONS,
      CRYPTO_KEY_LENGTH,
      'sha256'
    );
  } catch (error) {
    throw new Error(`Key derivation failed: ${error.message}`);
  }
}

/**
 * Encrypt plaintext using AES-256-GCM
 * @param {string} plaintext - Text to encrypt
 * @param {Buffer} key - 32-byte encryption key
 * @returns {Object} Object containing ciphertext, iv, and authTag (all hex strings)
 * @throws {Error} If encryption fails
 */
function encrypt(plaintext, key) {
  if (!plaintext || typeof plaintext !== 'string') {
    throw new Error('Plaintext must be a non-empty string');
  }

  if (!Buffer.isBuffer(key) || key.length !== CRYPTO_KEY_LENGTH) {
    throw new Error(`Key must be a ${CRYPTO_KEY_LENGTH}-byte Buffer`);
  }

  try {
    // Generate random IV (Initialization Vector)
    const iv = crypto.randomBytes(CRYPTO_IV_LENGTH);

    // Create cipher
    const cipher = crypto.createCipheriv(CRYPTO_ALGORITHM, key, iv);

    // Encrypt
    let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
    ciphertext += cipher.final('hex');

    // Get authentication tag (prevents tampering)
    const authTag = cipher.getAuthTag();

    return {
      ciphertext,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex')
    };
  } catch (error) {
    throw new Error(`Encryption failed: ${error.message}`);
  }
}

/**
 * Decrypt ciphertext using AES-256-GCM
 * @param {Object} encrypted - Object with ciphertext, iv, and authTag (hex strings)
 * @param {Buffer} key - 32-byte encryption key
 * @returns {string} Decrypted plaintext
 * @throws {Error} If decryption fails or authentication tag is invalid
 */
function decrypt(encrypted, key) {
  if (!encrypted || typeof encrypted !== 'object') {
    throw new Error('Encrypted data must be an object');
  }

  if (!encrypted.ciphertext || !encrypted.iv || !encrypted.authTag) {
    throw new Error('Encrypted data must contain ciphertext, iv, and authTag');
  }

  if (!Buffer.isBuffer(key) || key.length !== CRYPTO_KEY_LENGTH) {
    throw new Error(`Key must be a ${CRYPTO_KEY_LENGTH}-byte Buffer`);
  }

  try {
    // Create decipher
    const decipher = crypto.createDecipheriv(
      CRYPTO_ALGORITHM,
      key,
      Buffer.from(encrypted.iv, 'hex')
    );

    // Set authentication tag (will throw if data was tampered with)
    decipher.setAuthTag(Buffer.from(encrypted.authTag, 'hex'));

    // Decrypt
    let plaintext = decipher.update(encrypted.ciphertext, 'hex', 'utf8');
    plaintext += decipher.final('utf8');

    return plaintext;
  } catch (error) {
    // This error indicates either tampering or wrong key
    if (error.message.includes('Unsupported state or unable to authenticate data')) {
      throw new Error('Decryption failed: Data has been tampered with or wrong encryption key');
    }
    throw new Error(`Decryption failed: ${error.message}`);
  }
}

/**
 * Test encrypt/decrypt roundtrip
 * Used for internal testing and validation
 * @param {string} plaintext - Test plaintext
 * @param {Buffer} key - Encryption key
 * @returns {boolean} true if roundtrip succeeds
 */
function testRoundtrip(plaintext, key) {
  try {
    const encrypted = encrypt(plaintext, key);
    const decrypted = decrypt(encrypted, key);
    return decrypted === plaintext;
  } catch (error) {
    return false;
  }
}

module.exports = {
  generateSalt,
  deriveKey,
  encrypt,
  decrypt,
  testRoundtrip
};
