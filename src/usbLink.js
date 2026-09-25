/**
 * USB link ("USB device" mode) — server-side.
 *
 * A ScoreRelay device with no network still streams its live state over its
 * native USB port, and can carry its cloud connection over that same port
 * (usbTunnel.js). This module owns the serial port from the Node process, so
 * the connection stays up whether or not a browser window is open — that is
 * the whole reason it lives here rather than using the browser's Web Serial.
 *
 * Flow: open the port → send `{"t":"hello"}` → the device replies with its
 * firmware/sport, and, when its cloud relay is on, where the host should
 * connect. Then ping every few seconds (the device
 * stops streaming if it hasn't heard from a host) and deframe STATE / CTRL /
 * PIPE messages as they arrive.
 *
 * The serial transport is injectable (see `setTransportFactory`) so the
 * framing/handshake logic is testable without a device.
 */

'use strict';

const { UsbFrameParser, buildCtrlFrame, buildFrame, CH_STATE, CH_CTRL, CH_PIPE } = require('./usbFrame');
const { feedEnvelope } = require('./scoreboardData');
const usbTunnel = require('./usbTunnel');

const PING_INTERVAL_MS = 5000;
const RECONNECT_DELAY_MS = 3000;

let transportFactory = null; // lazily defaults to the real `serialport`
let port = null;
let portPath = '';
let parser = null;
let pingTimer = null;
let reconnectTimer = null;
let opened = false;
let lastFrameAt = 0;
let messageCount = 0;
let lastActivity = null;
let lastError = null;
let deviceInfo = { fw: null, sport: null };

function defaultTransport() {
  // Lazy so the module loads (and tests run) without the native dependency.
  const { SerialPort } = require('serialport');
  return SerialPort;
}

function setTransportFactory(factory) {
  transportFactory = factory;
}

function transport() {
  return transportFactory ? transportFactory() : defaultTransport();
}

async function listPorts() {
  const SerialPort = transport();
  const ports = await SerialPort.list();
  return (ports || []).map((p) => ({
    path: p.path,
    label: p.friendlyName || p.manufacturer || p.path,
    manufacturer: p.manufacturer || '',
    serialNumber: p.serialNumber || '',
  }));
}

function clearTimers() {
  if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
}

function scheduleReconnect() {
  if (!opened || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (opened) connect();
  }, RECONNECT_DELAY_MS);
}

function sendCtrl(obj) {
  if (!port || !port.isOpen) return;
  try {
    port.write(buildCtrlFrame(obj));
  } catch (err) {
    lastError = err;
  }
}

function writeFrame(channel, bytes) {
  if (!port || !port.isOpen) return;
  try {
    port.write(buildFrame(channel, bytes));
  } catch (err) {
    lastError = err;
  }
}

function handleCtrl(payload) {
  let obj;
  try {
    obj = JSON.parse(payload.toString('utf8'));
  } catch (_) {
    return;
  }
  if (!obj || obj.t !== 'hello') return;
  deviceInfo = { fw: obj.fw || null, sport: obj.sport || null };
  if (obj.tunnel && typeof obj.tunnel.host === 'string' && Number.isInteger(obj.tunnel.port) && obj.tunnel.port > 0) {
    usbTunnel.configure({ host: obj.tunnel.host, port: obj.tunnel.port });
  } else {
    // Device isn't tunnelling — drop any stale destination/socket.
    usbTunnel.reset();
  }
}

function onData(chunk) {
  lastFrameAt = Date.now();
  for (const frame of parser.feed(chunk)) {
    if (frame.channel === CH_STATE) {
      try {
        const envelope = JSON.parse(frame.payload.toString('utf8'));
        messageCount++;
        lastActivity = new Date();
        feedEnvelope(envelope, { onError: (err) => { lastError = err; } });
      } catch (_) {
        // ignore a malformed state payload
      }
    } else if (frame.channel === CH_CTRL) {
      handleCtrl(frame.payload);
    } else if (frame.channel === CH_PIPE) {
      usbTunnel.sendToCloud(frame.payload);
    }
  }
}

function connect() {
  let SerialPort;
  try {
    SerialPort = transport();
  } catch (err) {
    lastError = err;
    scheduleReconnect();
    return Promise.resolve(false);
  }

  return new Promise((resolve) => {
    let resolved = false;
    const done = (ok) => {
      if (!resolved) {
        resolved = true;
        resolve(ok);
      }
    };

    port = new SerialPort({ path: portPath, baudRate: 115200, autoOpen: false });
    parser = new UsbFrameParser();
    port.on('data', onData);
    port.on('error', (err) => {
      lastError = err;
      scheduleReconnect();
      done(false);
    });
    port.on('close', () => {
      if (opened) scheduleReconnect();
    });
    port.open((err) => {
      if (err) {
        lastError = err;
        scheduleReconnect();
        done(false);
        return;
      }
      lastError = null;
      lastFrameAt = Date.now();
      sendCtrl({ t: 'hello' });
      pingTimer = setInterval(() => sendCtrl({ t: 'ping' }), PING_INTERVAL_MS);
      done(true);
    });
  });
}

/** Open (or re-open) the device's USB port. Idempotent for the same path. */
function open(path) {
  if (opened && portPath === path && port && port.isOpen) {
    return Promise.resolve(true);
  }
  close();
  opened = true;
  portPath = path;
  return connect();
}

function close() {
  opened = false;
  clearTimers();
  usbTunnel.reset();
  if (port) {
    const closing = port;
    port = null;
    try {
      if (closing.isOpen) closing.close(() => {});
    } catch (_) {}
  }
  portPath = '';
}

function isConnected() {
  return !!(opened && port && port.isOpen);
}

function getStats() {
  return {
    active: opened,
    connected: isConnected(),
    portLabel: portPath || '',
    messageCount,
    lastActivity: lastActivity ? lastActivity.toISOString() : null,
    lastError: lastError ? lastError.message || String(lastError) : null,
    firmware: deviceInfo.fw,
    sport: deviceInfo.sport,
    tunnel: usbTunnel.status(),
  };
}

// Route whatever the relay receives from the cloud back onto the USB link.
usbTunnel.setOnData((data) => writeFrame(CH_PIPE, data));

module.exports = {
  setTransportFactory,
  listPorts,
  open,
  close,
  isConnected,
  getStats,
};
