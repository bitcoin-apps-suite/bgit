/**
 * bgit Constants - application configuration.
 *
 * The HandCash APP ID is a public identifier and is fine to ship. The APP
 * SECRET is a credential and MUST NOT live in source (a prior hardcoded secret
 * was leaked to the public repo and has been rotated). Provide it at runtime via
 * the HANDCASH_APP_SECRET env var — put it in .env.local (gitignored), which the
 * lightweight loader in index.js reads, or export it in your shell.
 *
 * Register/manage the app at https://dashboard.handcash.io/. OAuth redirect URLs:
 *   Success: http://localhost:3333/callback
 *   Decline: http://localhost:3333/error
 */

module.exports = {
  // HandCash Application Credentials — ID is public; SECRET comes from the env only.
  HANDCASH_APP_ID: process.env.HANDCASH_APP_ID || '6a692973fd940d4a35acf8ae',
  HANDCASH_APP_SECRET: process.env.HANDCASH_APP_SECRET || '',

  // Treasury wallet handle (where developer premiums are sent)
  TREASURY_HANDLE: 'b0ase',

  // OAuth server configuration
  OAUTH_PORT_START: 3333,
  OAUTH_PORT_END: 3333, // Fixed port to avoid conflicts with typical dev servers
  OAUTH_TIMEOUT_MS: 300000, // 5 minutes
  OAUTH_HOST: 'localhost',

  // Payment amounts in BSV
  PAYMENT_AMOUNTS: {
    commit: 0.001,  // 0.001 BSV per commit timestamp
    push: 0.001     // 0.001 BSV per push
  },

  // Config file paths (relative to user home directory)
  CONFIG_DIR_NAME: '.bgit',
  CONFIG_FILE_NAME: 'config.json',
  SALT_FILE_NAME: '.salt',

  // Encryption settings
  CRYPTO_ALGORITHM: 'aes-256-gcm',
  CRYPTO_KEY_LENGTH: 32,        // 256 bits
  CRYPTO_IV_LENGTH: 12,          // 96 bits for GCM
  CRYPTO_SALT_LENGTH: 32,        // 256 bits
  CRYPTO_TAG_LENGTH: 16,         // 128 bits
  CRYPTO_PBKDF2_ITERATIONS: 100000,  // 100k iterations for key derivation

  // Token validation cache TTL (1 hour)
  TOKEN_VALIDATION_CACHE_TTL_MS: 3600000,

  // Payment retry configuration
  PAYMENT_RETRY_MAX_ATTEMPTS: 3,
  PAYMENT_RETRY_BASE_DELAY_MS: 1000,
  PAYMENT_RETRY_MAX_DELAY_MS: 10000,

  // File permissions (Unix)
  DIR_PERMISSIONS: 0o700,   // rwx------
  FILE_PERMISSIONS: 0o600,  // rw-------
};
