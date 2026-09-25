const net = require('net');
const tls = require('tls');
const { feedEnvelope } = require('./scoreboardData');

// A single socket state shared by both connect variants.
let socket = null;
let buffer = '';

// Feed one parsed JSON object into the aggregator. In "local device" mode
// the device sends its envelope ({"type":"state"|"heartbeat","sport":...,
// "data":{...}}); merge the inner data object and track the sport. In
// plaintext mode each line is a flat field object.
function feedJson(obj, callbacks) {
  return feedEnvelope(obj, callbacks);
}

function handleSocketData(chunk, callbacks) {
  buffer += chunk.toString();
  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop() || '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      feedJson(JSON.parse(trimmed), callbacks);
    } catch (_) {
      // ignore invalid JSON lines
    }
  }
}

/**
 * Connect to an external plaintext TCP server that streams newline-delimited
 * JSON (legacy/dev mode — the ScoreRelay device feed itself is TLS, see
 * connectTls). Each line is a flat JSON object merged into the aggregator.
 * @param {{ host: string, port: number }} options
 * @param {{ onConnect: function?, onError: function?, onClose: function?, onMessage: function? }} callbacks
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
function connect(options, callbacks = {}) {
  if (socket && !socket.destroyed) {
    return Promise.resolve({ success: false, error: 'Already connected' });
  }

  buffer = '';

  return new Promise((resolve) => {
    socket = net.createConnection(
      { host: options.host, port: options.port },
      () => {
        callbacks.onConnect && callbacks.onConnect();
        resolve({ success: true });
      }
    );

    socket.on('data', (chunk) => handleSocketData(chunk, callbacks));

    socket.on('error', (err) => {
      callbacks.onError && callbacks.onError(err);
      if (!socket.destroyed) resolve({ success: false, error: err.message });
    });

    socket.on('close', () => {
      callbacks.onClose && callbacks.onClose();
    });
  });
}

/**
 * Connect to a ScoreRelay device's local TLS TCP feed ("Local device" mode).
 * The device uses a self-signed certificate, so TLS verification is disabled
 * at the transport layer; the API token in the first auth line is the actual
 * credential. Lines are the device's envelope JSON ({type, sport, data}).
 * @param {{ host: string, port: number, token: string }} options
 * @param {{ onConnect: function?, onError: function?, onClose: function?, onMessage: function? }} callbacks
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
function connectTls(options, callbacks = {}) {
  if (socket && !socket.destroyed) {
    return Promise.resolve({ success: false, error: 'Already connected' });
  }

  buffer = '';

  return new Promise((resolve) => {
    socket = tls.connect(
      { host: options.host, port: options.port, rejectUnauthorized: false },
      () => {
        // Send the auth line, then wait for auth_ok.
        socket.write(JSON.stringify({ type: 'auth', token: options.token }) + '\r\n');
      }
    );

    let authed = false;
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let obj;
        try {
          obj = JSON.parse(trimmed);
        } catch (_) {
          continue;
        }
        if (!authed) {
          if (obj.type === 'auth_ok') {
            authed = true;
            callbacks.onConnect && callbacks.onConnect();
            resolve({ success: true });
          } else {
            callbacks.onError && callbacks.onError(new Error('Device rejected the API token'));
            socket.destroy();
            resolve({ success: false, error: 'Device rejected the API token' });
            return;
          }
          continue;
        }
        feedJson(obj, callbacks);
      }
    });

    socket.on('error', (err) => {
      callbacks.onError && callbacks.onError(err);
      if (!socket.destroyed) resolve({ success: false, error: err.message });
    });

    socket.on('close', () => {
      callbacks.onClose && callbacks.onClose();
    });
  });
}

function disconnect() {
  if (socket) {
    try {
      socket.destroy();
    } catch (_) {}
    socket = null;
  }
  buffer = '';
}

function isConnected() {
  return !!(socket && !socket.destroyed);
}

module.exports = {
  connect,
  connectTls,
  disconnect,
  isConnected,
};
