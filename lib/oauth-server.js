/**
 * bgit OAuth Callback Server
 *
 * Temporary local HTTP server for capturing HandCash OAuth callbacks.
 * Runs on localhost:3000-3010 with 5-minute timeout.
 *
 * Features:
 * - Automatic port conflict resolution (tries 3000-3010)
 * - Timeout handling (5 minutes)
 * - Graceful shutdown after token capture
 * - User-friendly success/error pages
 */

const express = require('express');
const http = require('http');
const {
  OAUTH_PORT_START,
  OAUTH_PORT_END,
  OAUTH_TIMEOUT_MS,
  OAUTH_HOST
} = require('./constants');

/**
 * Start temporary OAuth callback server
 *
 * @param {number} startPort - First port to try (default: 3000)
 * @param {number} endPort - Last port to try (default: 3010)
 * @returns {Promise<{authToken: string, port: number, server: http.Server}>}
 * @throws {Error} If all ports are in use or timeout occurs
 */
async function startOAuthServer(startPort = OAUTH_PORT_START, endPort = OAUTH_PORT_END) {
  const app = express();
  let server;
  let actualPort;
  let resolveToken;
  let rejectToken;

  // Create promise for token capture
  const tokenPromise = new Promise((resolve, reject) => {
    resolveToken = resolve;
    rejectToken = reject;

    // Set timeout (5 minutes)
    setTimeout(() => {
      reject(new Error('OAuth timeout: No authorization received within 5 minutes'));
    }, OAUTH_TIMEOUT_MS);
  });

  // Success callback route
  app.get('/callback', (req, res) => {
    const { authToken } = req.query;

    if (authToken) {
      res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>bgit Authentication Successful</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            }
            .container {
              background: white;
              padding: 3rem;
              border-radius: 10px;
              box-shadow: 0 10px 40px rgba(0,0,0,0.2);
              text-align: center;
              max-width: 400px;
            }
            h1 {
              color: #2d3748;
              margin-bottom: 1rem;
            }
            .success-icon {
              font-size: 4rem;
              margin-bottom: 1rem;
            }
            p {
              color: #4a5568;
              line-height: 1.6;
            }
            .close-hint {
              margin-top: 2rem;
              font-size: 0.875rem;
              color: #718096;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="success-icon">✅</div>
            <h1>Authentication Successful!</h1>
            <p>Your HandCash wallet has been connected to bgit.</p>
            <p>You can now close this window and return to your terminal.</p>
            <div class="close-hint">This window will close automatically in 5 seconds...</div>
          </div>
          <script>
            setTimeout(() => window.close(), 5000);
          </script>
        </body>
        </html>
      `);

      // Resolve with token
      resolveToken({ authToken, port: actualPort, server });
    } else {
      res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>bgit Authentication Failed</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
            }
            .container {
              background: white;
              padding: 3rem;
              border-radius: 10px;
              box-shadow: 0 10px 40px rgba(0,0,0,0.2);
              text-align: center;
              max-width: 400px;
            }
            h1 {
              color: #2d3748;
              margin-bottom: 1rem;
            }
            .error-icon {
              font-size: 4rem;
              margin-bottom: 1rem;
            }
            p {
              color: #4a5568;
              line-height: 1.6;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="error-icon">❌</div>
            <h1>Authentication Failed</h1>
            <p>No authorization token received from HandCash.</p>
            <p>Please try again by running: <code>bgit auth login</code></p>
          </div>
        </body>
        </html>
      `);

      rejectToken(new Error('No auth token received in callback'));
    }
  });

  // Error callback route
  app.get('/error', (req, res) => {
    const { message } = req.query;

    res.status(400).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>bgit Authentication Error</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
          }
          .container {
            background: white;
            padding: 3rem;
            border-radius: 10px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
            text-align: center;
            max-width: 400px;
          }
          h1 {
            color: #2d3748;
            margin-bottom: 1rem;
          }
          .error-icon {
            font-size: 4rem;
            margin-bottom: 1rem;
          }
          p {
            color: #4a5568;
            line-height: 1.6;
          }
          .error-message {
            background: #fed7d7;
            padding: 1rem;
            border-radius: 5px;
            margin-top: 1rem;
            color: #c53030;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="error-icon">⚠️</div>
          <h1>Authentication Error</h1>
          <p>An error occurred during authentication:</p>
          <div class="error-message">${message || 'Unknown error'}</div>
          <p style="margin-top: 2rem;">Please try again by running: <code>bgit auth login</code></p>
        </div>
      </body>
      </html>
    `);

    rejectToken(new Error(`OAuth error: ${message || 'Unknown error'}`));
  });

  // Health check route
  app.get('/health', (req, res) => {
    res.send('OK');
  });

  // Try to start server on available port
  for (let port = startPort; port <= endPort; port++) {
    try {
      server = await new Promise((resolve, reject) => {
        const srv = http.createServer(app);

        srv.listen(port, OAUTH_HOST, () => {
          actualPort = port;
          resolve(srv);
        });

        srv.on('error', (err) => {
          if (err.code === 'EADDRINUSE') {
            resolve(null); // Try next port
          } else {
            reject(err);
          }
        });
      });

      if (server) {
        console.log(`OAuth server started on http://${OAUTH_HOST}:${actualPort}`);
        break; // Successfully started
      }
    } catch (error) {
      throw new Error(`Failed to start OAuth server: ${error.message}`);
    }
  }

  if (!server) {
    throw new Error(`All ports (${startPort}-${endPort}) are in use. Please free up a port and try again.`);
  }

  // Wait for token or timeout
  const result = await tokenPromise;

  return result;
}

/**
 * Stop OAuth server
 *
 * @param {http.Server} server - Server instance to stop
 * @returns {Promise<void>}
 */
function stopOAuthServer(server) {
  return new Promise((resolve, reject) => {
    if (!server) {
      resolve();
      return;
    }

    server.close((err) => {
      if (err) {
        reject(new Error(`Failed to stop OAuth server: ${err.message}`));
      } else {
        console.log('OAuth server stopped');
        resolve();
      }
    });
  });
}

module.exports = {
  startOAuthServer,
  stopOAuthServer
};
