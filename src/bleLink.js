/**
 * Bluetooth LE link ("Bluetooth device" mode) — server-side.
 *
 * A ScoreRelay device can be reached over Bluetooth with no network at all.
 * This module owns that session: it connects, signs in with the device's
 * admin password, then asks the device for its live state about once a second
 * and feeds it to the same outputs every other mode uses. The same link also
 * carries device management (status, Wi-Fi, controller, password, reboot),
 * which is why requests are queued: the device answers one request at a time.
 *
 * The radio itself is behind a small transport (`bleTransport.js` — a helper
 * process, so a Bluetooth-permission failure can never take this server
 * down). Everything here is transport-agnostic and testable with a fake; see
 * `setTransportFactory`.
 *
 * If the device is set to reach the cloud through this computer, this module
 * also relays that connection: it passes bytes between the device and the
 * cloud and holds no cloud credentials.
 *
 * The admin password is held in memory for the life of the session (so a
 * dropped link can sign back in) and is never written to disk or logged.
 */

'use strict';

const { encodeRequest, ReplyAssembler, MIN_WRITE_PAYLOAD } = require('./bleFrame');
const { feedEnvelope } = require('./scoreboardData');
const { createTunnel } = require('./usbTunnel');

const POLL_MS = 1000;
const RPC_TIMEOUT_MS = 20000;
const BUSY_RETRIES = 3;
const BUSY_DELAY_MS = 250;
const POLL_TIMEOUTS_BEFORE_DROP = 3;
const RECONNECT_MIN_MS = 3000;
const RECONNECT_MAX_MS = 30000;

/**
 * The device requests a caller may reach through `call()`, with a timeout for
 * each (a Wi-Fi scan or network test is slow). Anything not listed is refused.
 */
const MANAGEMENT_METHODS = {
  getStatus: 20000,
  networkTest: 25000,
  getControllerList: 20000,
  getControllerConfig: 20000,
  setControllerConfig: 20000,
  scanWifi: 40000,
  configureWifi: 20000,
  reboot: 8000,
};

class BleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BleError';
    this.code = code;
  }
}

// This link's own cloud relay (the USB link has a separate one).
const tunnel = createTunnel();

let transportFactory = null; // lazily defaults to the real helper-process transport
let transport = null;
let assembler = null;

let opened = false; // the user wants a connection
let deviceId = '';
let deviceName = '';
let password = ''; // memory only
let phase = 'idle'; // idle | starting | connecting | authenticating | connected | password_change_required | reconnecting | error
let linkUp = false; // Bluetooth link is up (login may or may not have succeeded)
let established = false; // we have been fully signed in at least once this session
let mustChange = false;
let writePayload = MIN_WRITE_PAYLOAD;

let waiter = null;
let queue = Promise.resolve();
let nextId = 1;
let nextMsgid = 0;

let pollTimer = null;
let pollTimeouts = 0;
let reconnectTimer = null;
let pollMs = POLL_MS;
let reconnectMinMs = RECONNECT_MIN_MS;
let reconnectDelay = RECONNECT_MIN_MS;
let generation = 0; // bumped on every open/close so stale async work can tell it is stale

let messageCount = 0;
let lastActivity = null;
let lastError = null;
let deviceInfo = null;

// Cloud relay state. `state` is one of: off (nothing to do yet), unsupported
// (device firmware has no relay), not_enabled, not_provisioned, active, error.
let pipeCapable = false;
let relay = { state: 'off', error: null };
let pipeQueue = Promise.resolve();

function defaultTransport() {
  // Lazy so the module loads (and tests run) without spawning anything.
  return require('./bleTransport').create();
}

function setTransportFactory(factory) {
  transportFactory = factory;
  dropTransport();
}

/** Replace how the relay opens its TCP connection (tests). */
function setTunnelConnector(fn) {
  tunnel.setConnector(fn);
}

function getTransport() {
  if (!transport) {
    transport = transportFactory ? transportFactory() : defaultTransport();
    assembler = new ReplyAssembler((err) => failWaiter(new BleError('truncated', err.message)));
    transport.on('data', (chunk) => onData(chunk));
    transport.on('pipe', (chunk) => tunnel.sendToCloud(chunk));
    transport.on('disconnected', (reason) => onLinkLost(reason));
    transport.on('dead', (err) => onTransportDead(err));
  }
  return transport;
}

function dropTransport() {
  if (!transport) return;
  const t = transport;
  transport = null;
  try { t.removeAllListeners(); t.kill(); } catch (_) {}
}

/** Override the poll / first-reconnect intervals (tests). */
function setTimings(t) {
  if (t && t.pollMs > 0) pollMs = t.pollMs;
  if (t && t.reconnectMs > 0) { reconnectMinMs = t.reconnectMs; reconnectDelay = t.reconnectMs; }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// -- request / reply -----------------------------------------------------

function failWaiter(err) {
  if (!waiter) return;
  const w = waiter;
  waiter = null;
  clearTimeout(w.timer);
  w.reject(err);
}

function onData(chunk) {
  for (const text of assembler.feed(chunk)) {
    let msg;
    try {
      msg = JSON.parse(text);
    } catch (_) {
      continue;
    }
    if (waiter && msg && msg.id === waiter.id) {
      const w = waiter;
      waiter = null;
      clearTimeout(w.timer);
      w.resolve(msg);
    }
  }
}

/**
 * A refused write almost always means this computer has not been paired with
 * the device yet. Say so, in terms the user can act on.
 */
function describeWriteFailure(err) {
  const msg = (err && err.message) || String(err);
  if (err && err.code === 'not_paired') return err;
  if (/auth|encrypt|pair|security|insufficient|not permitted/i.test(msg)) {
    return new BleError(
      'not_paired',
      'This computer is not paired with the device yet. Pair it once with the 6-digit passkey ' +
        "from the device's label or your ScoreRelay portal (macOS asks for it automatically; on " +
        'Windows or Linux, pair it in your system Bluetooth settings first), then connect again.'
    );
  }
  return err instanceof BleError ? err : new BleError('write_failed', msg);
}

function sendAndWait(method, params, timeoutMs) {
  return new Promise((resolve, reject) => {
    const id = nextId;
    nextId = nextId >= 0x7fffffff ? 1 : nextId + 1;
    const timer = setTimeout(() => {
      if (waiter && waiter.id === id) waiter = null;
      reject(new BleError('timeout', "The device did not answer '" + method + "' in time"));
    }, timeoutMs);
    // Registered before the write so a fast reply cannot slip past us.
    waiter = { id, resolve, reject, timer };

    nextMsgid = (nextMsgid % 255) + 1;
    let frames;
    try {
      frames = encodeRequest(Buffer.from(JSON.stringify({ id, method, params: params || {} }), 'utf8'), writePayload, nextMsgid);
    } catch (err) {
      failWaiter(new BleError('request_too_large', err.message));
      return;
    }
    (async () => {
      const t = getTransport();
      for (const frame of frames) await t.write(frame);
    })().catch((err) => failWaiter(describeWriteFailure(err)));
  });
}

async function doRpc(method, params, timeoutMs) {
  for (let attempt = 0; ; attempt++) {
    if (!linkUp) throw new BleError('disconnected', 'Not connected to a device');
    const reply = await sendAndWait(method, params, timeoutMs || RPC_TIMEOUT_MS);
    if (reply.ok) return reply.result;
    const e = reply.error || {};
    // The device is mid-way through another request; it dropped ours, so retry.
    if (e.code === 'busy' && attempt < BUSY_RETRIES) {
      await sleep(BUSY_DELAY_MS);
      continue;
    }
    throw new BleError(e.code || 'device_error', e.message || "The device rejected '" + method + "'");
  }
}

/** Queue one request; the device handles a single request at a time. */
function rpc(method, params, timeoutMs) {
  const run = () => doRpc(method, params, timeoutMs);
  const result = queue.then(run, run);
  queue = result.catch(() => {});
  return result;
}

// -- session -------------------------------------------------------------

function isLive() {
  return opened && linkUp;
}

async function login() {
  const result = await rpc('login', { password });
  mustChange = !!(result && result.must_change_password);
}

async function refreshInfo() {
  try {
    deviceInfo = await rpc('getStatus');
  } catch (_) {
    // Status is informational; a failure here must not fail the connection.
  }
}

async function establish(gen) {
  phase = 'connecting';
  const t = getTransport();
  const info = await t.connect(deviceId);
  if (gen !== generation) return;
  linkUp = true;
  pipeCapable = !!(info && info.pipe);
  writePayload = Math.max(MIN_WRITE_PAYLOAD, (info && info.writePayload) | 0);
  assembler.reset();

  phase = 'authenticating';
  await login();
  if (gen !== generation) return;
  established = true;
  reconnectDelay = reconnectMinMs;
  lastError = null;
  phase = mustChange ? 'password_change_required' : 'connected';
  await refreshInfo();
  if (gen !== generation) return;
  schedulePoll(0);
  if (!mustChange) await setupRelay(gen);
}

// -- cloud relay ---------------------------------------------------------

function resetRelay() {
  tunnel.reset();
  relay = { state: 'off', error: null };
}

/** Device → cloud bytes arrive from the tunnel's socket; send them to the device. */
tunnel.setOnData((data) => {
  const size = Math.max(MIN_WRITE_PAYLOAD, writePayload);
  // One ordered queue: the stream must reach the device in sequence.
  pipeQueue = pipeQueue
    .then(async () => {
      if (!isLive() || relay.state !== 'active') return;
      for (let off = 0; off < data.length; off += size) {
        await getTransport().pipeWrite(data.subarray(off, off + size));
      }
    })
    .catch((err) => { relay = { state: 'error', error: err.message || 'relay write failed' }; });
});

async function setupRelay(gen) {
  resetRelay();
  if (!pipeCapable) { relay.state = 'unsupported'; return; }
  try {
    const info = await rpc('getTunnelInfo');
    if (gen !== generation) return;
    if (!info.enabled) { relay.state = 'not_enabled'; return; }
    if (!info.provisioned || !info.tunnel) { relay.state = 'not_provisioned'; return; }
    tunnel.configure({ host: info.tunnel.host, port: info.tunnel.port });
    await getTransport().pipeStart();
    if (gen !== generation) { tunnel.reset(); return; }
    relay = { state: 'active', error: null };
  } catch (err) {
    if (gen !== generation) return;
    // A device that predates the relay rejects the request: treat that as
    // "not supported", not as a fault.
    const old = ['unknown_method', 'bad_request', 'not_found'].includes(err.code);
    relay = old ? { state: 'unsupported', error: null } : { state: 'error', error: err.message };
  }
}

function clearPoll() {
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
}

function schedulePoll(delay) {
  if (!isLive() || pollTimer) return;
  pollTimer = setTimeout(pollOnce, delay == null ? pollMs : delay);
}

async function pollOnce() {
  pollTimer = null;
  if (!isLive()) return;
  const gen = generation;
  if (!mustChange) {
    try {
      const envelope = await rpc('getState');
      pollTimeouts = 0;
      messageCount++;
      lastActivity = new Date();
      if (lastError && lastError.transient) lastError = null;
      feedEnvelope(envelope, { onError: (err) => { lastError = err; } });
    } catch (err) {
      await handlePollError(err, gen);
    }
  }
  if (gen === generation) schedulePoll();
}

async function handlePollError(err, gen) {
  if (gen !== generation || !isLive()) return;
  if (err.code === 'disconnected') return; // onLinkLost owns this
  if (err.code === 'unauthorized') {
    // The device no longer recognises our session (e.g. it restarted).
    try {
      await login();
      return;
    } catch (loginErr) {
      lastError = loginErr;
      return;
    }
  }
  if (err.code === 'must_change_password') {
    mustChange = true;
    phase = 'password_change_required';
    return;
  }
  if (err.code === 'timeout') {
    if (++pollTimeouts >= POLL_TIMEOUTS_BEFORE_DROP) {
      pollTimeouts = 0;
      lastError = new BleError('timeout', 'The device stopped answering; reconnecting…');
      try { await getTransport().disconnect(); } catch (_) {}
    }
    return;
  }
  // e.g. no_state: the device is up but has no scoreboard data yet.
  lastError = Object.assign(err, { transient: true });
}

function clearReconnect() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
}

function scheduleReconnect() {
  if (!opened || reconnectTimer || !established) return;
  const gen = generation;
  phase = 'reconnecting';
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    if (!opened || gen !== generation) return;
    try {
      await establish(gen);
    } catch (err) {
      if (gen !== generation) return;
      lastError = err;
      linkUp = false;
      // A rejected password must not be retried on a timer.
      if (err.code === 'unauthorized') {
        phase = 'error';
        established = false;
        return;
      }
      reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
      scheduleReconnect();
    }
  }, reconnectDelay);
}

function onLinkLost(reason) {
  linkUp = false;
  clearPoll();
  resetRelay();
  failWaiter(new BleError('disconnected', 'Bluetooth link to the device was lost' + (reason ? ' (' + reason + ')' : '')));
  if (assembler) assembler.reset();
  if (!opened) return;
  if (established) {
    lastError = new BleError('disconnected', 'Bluetooth link lost; reconnecting…');
    scheduleReconnect();
  }
}

function onTransportDead(err) {
  const fatal = err instanceof BleError ? err : new BleError('bluetooth_unavailable', (err && err.message) || 'Bluetooth helper stopped');
  dropTransport();
  linkUp = false;
  clearPoll();
  resetRelay();
  failWaiter(fatal);
  if (!opened) return;
  lastError = fatal;
  if (established && fatal.code !== 'permission_denied') {
    scheduleReconnect();
  } else {
    phase = 'error';
  }
}

// -- public API ----------------------------------------------------------

/** List nearby ScoreRelay devices (scans for `ms`). */
async function scan(ms) {
  const t = getTransport();
  try {
    await t.start();
    return await t.scan(ms || 6000);
  } catch (err) {
    if (err instanceof BleError && (err.code === 'permission_denied' || err.code === 'bluetooth_unavailable')) dropTransport();
    throw err;
  }
}

/**
 * Connect to a device, sign in, and start streaming its state.
 * Resolves `{ success }` / `{ success: false, error }` like the other modes.
 */
async function open({ id, name, adminPassword }) {
  close();
  opened = true;
  const gen = ++generation;
  deviceId = id;
  deviceName = name || '';
  password = adminPassword;
  phase = 'starting';
  lastError = null;
  messageCount = 0;
  lastActivity = null;
  deviceInfo = null;
  mustChange = false;
  established = false;
  pollTimeouts = 0;
  reconnectDelay = reconnectMinMs;

  try {
    await getTransport().start();
    if (gen !== generation) return { success: false, error: 'Cancelled' };
    await establish(gen);
    if (gen !== generation) return { success: false, error: 'Cancelled' };
    return { success: true };
  } catch (err) {
    if (gen !== generation) return { success: false, error: 'Cancelled' };
    const fatal = err.code === 'permission_denied' || err.code === 'bluetooth_unavailable';
    if (fatal) dropTransport();
    // Leave nothing half-open behind a failed connect, but keep the reason
    // visible in the stats.
    close();
    lastError = err;
    phase = 'error';
    return { success: false, error: err.message || 'Failed to connect over Bluetooth' };
  }
}

function close() {
  opened = false;
  generation++;
  clearPoll();
  clearReconnect();
  failWaiter(new BleError('disconnected', 'Disconnected'));
  const wasUp = linkUp;
  linkUp = false;
  established = false;
  mustChange = false;
  password = '';
  phase = 'idle';
  resetRelay();
  if (transport && (wasUp || deviceId)) {
    transport.disconnect().catch(() => {});
  }
  deviceId = '';
  deviceName = '';
  deviceInfo = null;
}

function isConnected() {
  return isLive() && (phase === 'connected' || phase === 'password_change_required');
}

/** Run one whitelisted management request against the connected device. */
async function call(method, params) {
  if (!Object.prototype.hasOwnProperty.call(MANAGEMENT_METHODS, method)) {
    throw new BleError('not_allowed', "'" + method + "' is not available from this app");
  }
  if (!isConnected()) throw new BleError('disconnected', 'Not connected to a device');
  let result;
  try {
    result = await rpc(method, params || {}, MANAGEMENT_METHODS[method]);
  } catch (err) {
    // The device restarts right after acknowledging a reboot, so the reply
    // (or the link) can vanish; that is the expected outcome.
    if (method === 'reboot' && (err.code === 'timeout' || err.code === 'disconnected')) return { status: 'ok' };
    throw err;
  }
  if (method === 'getStatus') deviceInfo = result;
  return result;
}

/**
 * Change the device's admin password. Kept apart from `call()` because the
 * session's stored password has to follow it, or the next reconnect would
 * sign in with the old one.
 */
async function changePassword(current, next) {
  if (!isConnected()) throw new BleError('disconnected', 'Not connected to a device');
  await rpc('changePassword', { current_password: current, new_password: next, confirm_password: next });
  password = next;
  if (mustChange) {
    mustChange = false;
    phase = 'connected';
    schedulePoll(0);
  }
  await refreshInfo();
  if (relay.state === 'off') await setupRelay(generation);
}

/**
 * Turn the device's cloud relay on or off. The device applies the setting on
 * its next start, so this also restarts it; the session reconnects by itself
 * and the relay comes up if it is on and the device is set up for the cloud.
 */
async function setRelay(enabled) {
  if (!isConnected()) throw new BleError('disconnected', 'Not connected to a device');
  if (mustChange) throw new BleError('must_change_password', 'Set a new admin password first');
  if (!pipeCapable) throw new BleError('unsupported', 'This device does not support the cloud relay');
  await rpc('setTunnel', { enabled: !!enabled });
  try {
    await rpc('reboot', {}, MANAGEMENT_METHODS.reboot);
  } catch (err) {
    if (err.code !== 'timeout' && err.code !== 'disconnected') throw err;
  }
}

function getStats() {
  return {
    active: opened,
    connected: isConnected(),
    phase,
    deviceId,
    deviceName,
    messageCount,
    lastActivity: lastActivity ? lastActivity.toISOString() : null,
    lastError: lastError ? lastError.message || String(lastError) : null,
    lastErrorCode: lastError && lastError.code ? lastError.code : null,
    mustChangePassword: mustChange,
    relay: {
      state: relay.state,
      // A plain yes/no; where the device connects to is deliberately not exposed.
      connected: relay.state === 'active' && tunnel.isConnected(),
      error: relay.error,
    },
    device: deviceInfo
      ? {
          deviceId: deviceInfo.device_id || null,
          firmware: deviceInfo.firmware_version || null,
          wifiIp: deviceInfo.wifi_sta_ip || null,
          wifiProvision: deviceInfo.wifi_provision || null,
        }
      : null,
  };
}

/** Stop everything, including the helper process (process exit / tests). */
function shutdown() {
  close();
  dropTransport();
}

module.exports = {
  BleError,
  MANAGEMENT_METHODS,
  setTransportFactory,
  setTunnelConnector,
  setTimings,
  scan,
  open,
  close,
  isConnected,
  call,
  changePassword,
  setRelay,
  getStats,
  shutdown,
};
