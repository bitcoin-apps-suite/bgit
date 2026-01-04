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
          <title>bgit - Authentication Successful</title>
          <meta charset="UTF-8">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }

            body {
              background: #000;
              color: #fff;
              font-family: 'Courier New', monospace;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              overflow: hidden;
            }

            .terminal {
              width: 90%;
              max-width: 800px;
              padding: 2rem;
              border: 2px solid #fff;
              box-shadow: 0 0 20px rgba(255,255,255,0.3);
              position: relative;
            }

            .ascii-logo {
              font-size: 10px;
              line-height: 1.2;
              white-space: pre;
              text-align: center;
              margin-bottom: 2rem;
              animation: glow 2s ease-in-out infinite;
            }

            .blockchain {
              font-size: 14px;
              line-height: 1.4;
              white-space: pre;
              text-align: center;
              margin: 2rem 0;
              opacity: 0;
              animation: fadeIn 1s ease-in 0.5s forwards, pulse 3s ease-in-out 1.5s infinite;
            }

            .message {
              text-align: center;
              font-size: 14px;
              line-height: 1.8;
              margin: 2rem 0;
              opacity: 0;
              animation: typewriter 2s steps(40) 1s forwards;
            }

            .status {
              text-align: center;
              font-size: 12px;
              margin-top: 2rem;
              opacity: 0;
              animation: fadeIn 0.5s ease-in 3s forwards;
              color: #0f0;
            }

            .btc-symbol {
              display: inline-block;
              animation: spin 4s linear infinite;
            }

            @keyframes glow {
              0%, 100% { text-shadow: 0 0 5px #fff, 0 0 10px #fff; }
              50% { text-shadow: 0 0 10px #fff, 0 0 20px #fff, 0 0 30px #fff; }
            }

            @keyframes fadeIn {
              to { opacity: 1; }
            }

            @keyframes typewriter {
              to { opacity: 1; }
            }

            @keyframes pulse {
              0%, 100% { opacity: 1; }
              50% { opacity: 0.6; }
            }

            @keyframes spin {
              from { transform: rotate(0deg); }
              to { transform: rotate(360deg); }
            }

            .blink {
              animation: blink 1s step-end infinite;
            }

            @keyframes blink {
              0%, 50% { opacity: 1; }
              51%, 100% { opacity: 0; }
            }
          </style>
        </head>
        <body>
          <div class="terminal">
            <div class="ascii-logo">
██████╗       ██████╗ ██╗████████╗
██╔══██╗     ██╔════╝ ██║╚══██╔══╝
██████╔╝     ██║  ███╗ ██║   ██║
██╔══██╗     ██║   ██║ ██║   ██║
██████╔╝ ██╗ ╚██████╔╝ ██║   ██║
╚═════╝  ╚═╝  ╚═════╝  ╚═╝   ╚═╝
            </div>

            <div class="blockchain">
┌─────────┐     ┌─────────┐     ┌─────────┐
│ BLOCK 1 │────▶│ BLOCK 2 │────▶│ BLOCK 3 │
│  <span class="btc-symbol">₿</span>  AUTH │     │  <span class="btc-symbol">₿</span>  DATA │     │  <span class="btc-symbol">₿</span>  SYNC │
└─────────┘     └─────────┘     └─────────┘
            </div>

            <div class="message">
╔═══════════════════════════════════════╗
║  ✓ AUTHENTICATION SUCCESSFUL          ║
║                                       ║
║  HandCash wallet connected to bgit    ║
║  Encrypted token saved locally        ║
║  Ready for blockchain timestamping    ║
╚═══════════════════════════════════════╝
            </div>

            <div class="status">
> Authentication complete! You can close this window now<span class="blink">_</span>
            </div>
          </div>

          <script>
            // Try to auto-close (works if window was opened by script)
            setTimeout(() => {
              // Attempt to close
              window.close();

              // If still open after 500ms, show manual instruction
              setTimeout(() => {
                if (!window.closed) {
                  document.querySelector('.status').innerHTML =
                    '> Press <strong>Cmd+W</strong> (Mac) or <strong>Ctrl+W</strong> (Windows) to close<span class="blink">_</span>';
                }
              }, 500);
            }, 3000);
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
