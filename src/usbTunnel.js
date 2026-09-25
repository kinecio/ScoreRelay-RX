/**
 * USB cloud tunnel — the host side of the device's cloud-over-USB link.
 *
 * A device with no WiFi/Ethernet can reach the ScoreRelay cloud through this
 * computer. This module passes the device's connection along as opaque bytes
 * and holds no cloud credentials.
 *
 * The destination is supplied by the device at runtime rather than stored
 * here, because this repository is public.
 *
 * Kept transport-agnostic and dependency-free so `test/usbTunnel.test.js` can
 * drive it with a fake socket.
 */

'use strict';

const net = require('net');

/**
 * Each carrier (the USB link, the Bluetooth link) gets its own relay so that
 * two of them never share a socket or an on-data callback. The default export
 * is the instance the USB link uses.
 */
function createTunnel() {
  let socket = null;
  let host = '';
  let port = 0;
  let onData = null; // (Buffer) => void — caller writes it back to the device
  let pending = [];
  let connecting = false;
  let lastError = null;

  // Injectable for tests; defaults to a real TCP connection.
  let connector = (h, p) => net.createConnection({ host: h, port: p });

  function setOnData(fn) {
    onData = fn;
  }

  function setConnector(fn) {
    connector = fn || ((h, p) => net.createConnection({ host: h, port: p }));
  }

  /** Remember where to dial. Does not open the socket yet — the first PIPE
   *  payload does that, so an enabled-but-idle relay holds no open connection. */
  function configure(info) {
    host = info && typeof info.host === 'string' ? info.host : '';
    port = info && Number.isInteger(info.port) ? info.port : 0;
  }

  function ensureConnected() {
    if (socket && !socket.destroyed) return;
    if (!host || port <= 0 || connecting) return;
    connecting = true;
    const s = connector(host, port);
    socket = s;
    s.on('connect', () => {
      connecting = false;
      const queued = pending;
      pending = [];
      for (const chunk of queued) {
        try { s.write(chunk); } catch (_) {}
      }
    });
    s.on('data', (data) => {
      if (onData) onData(data);
    });
    s.on('error', (err) => {
      lastError = err;
      connecting = false;
      if (socket === s) socket = null;
    });
    s.on('close', () => {
      connecting = false;
      if (socket === s) socket = null;
    });
  }

  /** Device → cloud. Buffers briefly while the socket is opening. */
  function sendToCloud(chunk) {
    if (!chunk || !chunk.length) return;
    if (socket && !socket.destroyed && socket.writable) {
      socket.write(chunk);
      return;
    }
    if (pending.length < 32) pending.push(chunk);
    ensureConnected();
  }

  function stop() {
    if (socket) {
      try { socket.destroy(); } catch (_) {}
      socket = null;
    }
    pending = [];
    connecting = false;
  }

  function isConnected() {
    return !!(socket && !socket.destroyed);
  }

  function status() {
    return {
      configured: !!host && port > 0,
      connected: isConnected(),
      host: host || null,
      port: port > 0 ? port : null,
      error: lastError ? lastError.message || String(lastError) : null,
    };
  }

  /** Full reset (used on disconnect/tests). */
  function reset() {
    stop();
    host = '';
    port = 0;
    lastError = null;
  }

  return {
    setOnData,
    setConnector,
    configure,
    ensureConnected,
    sendToCloud,
    stop,
    reset,
    isConnected,
    status,
  };
}

module.exports = createTunnel();
module.exports.createTunnel = createTunnel;
