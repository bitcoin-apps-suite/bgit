/**
 * Local broadcast bridge.
 *
 * Upstream's publisher and claim verbs broadcast by POSTing `{ rawTx: "<hex>" }`
 * to a `--bridge <url>` endpoint. No public BSV provider speaks that shape:
 * WhatsOnChain wants `{ txhex }`, the ARC endpoints want a raw binary body.
 *
 * Upstream deliberately ships NO default bridge — a tool must not silently route
 * anyone's transactions through infrastructure they did not choose. We honour
 * that rather than route around it: instead of hardcoding a remote endpoint, we
 * start an ephemeral bridge on the user's own loopback interface that translates
 * their contract into lib/funding.js's provider fallback chain. The only host
 * involved by default is the user's machine.
 *
 * Bound to 127.0.0.1 on an OS-assigned port, and shut down when the publish ends.
 */

const http = require('http');
const { broadcast } = require('./funding');

const MAX_BODY_BYTES = 64 * 1024 * 1024; // a part transaction is ~10 MB; leave headroom

/**
 * Start the bridge.
 *
 * @param {{onBroadcast?: (info: object) => void}} [opts]
 * @returns {Promise<{url: string, port: number, close: () => Promise<void>, count: () => number}>}
 */
function startBridge(opts = {}) {
  let broadcastCount = 0;

  const server = http.createServer((req, res) => {
    const reply = (status, payload) => {
      const body = JSON.stringify(payload);
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      });
      res.end(body);
    };

    if (req.method !== 'POST') {
      reply(405, { error: 'bridge accepts POST only' });
      return;
    }

    const chunks = [];
    let size = 0;
    let aborted = false;

    req.on('data', (chunk) => {
      if (aborted) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        aborted = true;
        reply(413, { error: `body exceeds ${MAX_BODY_BYTES} bytes` });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', async () => {
      if (aborted) return;

      let rawTx;
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        rawTx = parsed.rawTx;
      } catch (error) {
        reply(400, { error: `malformed JSON: ${error.message}` });
        return;
      }

      if (typeof rawTx !== 'string' || !/^[0-9a-fA-F]+$/.test(rawTx) || rawTx.length % 2 !== 0) {
        reply(400, { error: 'rawTx must be an even-length hex string' });
        return;
      }

      try {
        const result = await broadcast(rawTx);
        broadcastCount++;
        if (opts.onBroadcast) opts.onBroadcast(result);
        reply(200, { txid: result.txid, provider: result.provider });
      } catch (error) {
        /**
         * Upstream treats HTTP 422 as the network's terminal verdict and stops
         * immediately; anything else lets it try the next bridge. Only pass 422
         * up when every provider actually judged the transaction (4xx). An
         * outage or timeout gets 502, so a publish is never abandoned because
         * someone else's API was down.
         */
        reply(error.isNetworkVerdict ? 422 : 502, { error: error.message });
      }
    });

    req.on('error', () => {
      if (!aborted) reply(400, { error: 'request stream error' });
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}/`,
        port,
        count: () => broadcastCount,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

module.exports = { startBridge };
