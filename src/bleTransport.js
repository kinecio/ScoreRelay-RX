/**
 * Parent-side handle on the Bluetooth helper process (`bleWorker.js`).
 *
 * Presents the small transport surface `bleLink.js` expects:
 *   start() / scan(ms) / connect(id) / write(buf) / disconnect() / kill()
 *   pipeStart() / pipeStop() / pipeWrite(buf)   — the cloud-relay byte stream
 *   events: 'data' (Buffer), 'pipe' (Buffer), 'disconnected' (reason), 'dead' (Error)
 *
 * If the helper dies — including the macOS abort that follows a missing
 * Bluetooth permission — every waiting request is failed with an error that
 * says what to do about it, and 'dead' is emitted; the server keeps running.
 */

'use strict';

const { EventEmitter } = require('events');
const path = require('path');
const { fork } = require('child_process');

const START_TIMEOUT_MS = 20000;
const SCAN_SLACK_MS = 15000;
const CONNECT_TIMEOUT_MS = 150000; // includes time to type a pairing passkey
const WRITE_TIMEOUT_MS = 15000;

function bleError(code, message) {
  return Object.assign(new Error(message), { name: 'BleError', code });
}

function exitError(code, signal) {
  if (process.platform === 'darwin' && (signal === 'SIGABRT' || signal === 'SIGTRAP' || code === 134)) {
    return bleError(
      'permission_denied',
      'macOS did not allow Bluetooth for this app. Open System Settings → Privacy & Security → Bluetooth, ' +
        'turn it on for the app that launched ScoreRelay-RX (for example Terminal), then try again.'
    );
  }
  return bleError('bluetooth_unavailable', 'The Bluetooth helper stopped unexpectedly (' + (signal || 'exit ' + code) + ').');
}

class HelperTransport extends EventEmitter {
  constructor() {
    super();
    this.child = null;
    this.pending = new Map();
    this.nextReq = 1;
    this.starting = null;
    this.dead = false;
  }

  _spawn() {
    // `fork` runs the helper script with this same runtime; in a packaged
    // build it resolves the script inside the package.
    // ELECTRON_RUN_AS_NODE makes the desktop app's own binary behave as plain
    // Node for this child (it is ignored when running under Node itself).
    const child = fork(path.join(__dirname, 'bleWorker.js'), [], {
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
    this.child = child;
    child.on('message', (msg) => this._onMessage(msg));
    child.on('error', (err) => this._die(bleError('bluetooth_unavailable', 'Could not start the Bluetooth helper: ' + err.message)));
    child.on('exit', (code, signal) => this._die(exitError(code, signal)));
  }

  _onMessage(msg) {
    if (!msg) return;
    if (msg.ev === 'data') {
      this.emit('data', Buffer.from(msg.b64 || '', 'base64'));
    } else if (msg.ev === 'pipe') {
      this.emit('pipe', Buffer.from(msg.b64 || '', 'base64'));
    } else if (msg.ev === 'disconnected') {
      this.emit('disconnected', msg.reason || '');
    } else if (typeof msg.reqId === 'number') {
      const p = this.pending.get(msg.reqId);
      if (!p) return;
      this.pending.delete(msg.reqId);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(bleError((msg.error && msg.error.code) || 'ble_error', (msg.error && msg.error.message) || 'Bluetooth error'));
    }
  }

  _die(err) {
    if (this.dead) return;
    this.dead = true;
    this.child = null;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
    this.emit('dead', err);
  }

  _request(op, fields, timeoutMs) {
    if (this.dead || !this.child) return Promise.reject(bleError('bluetooth_unavailable', 'The Bluetooth helper is not running.'));
    return new Promise((resolve, reject) => {
      const reqId = this.nextReq++;
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        reject(bleError('timeout', 'Bluetooth did not respond (' + op + ').'));
      }, timeoutMs);
      this.pending.set(reqId, { resolve, reject, timer });
      try {
        this.child.send({ reqId, op, ...fields });
      } catch (err) {
        this.pending.delete(reqId);
        clearTimeout(timer);
        reject(bleError('bluetooth_unavailable', 'The Bluetooth helper is not reachable: ' + err.message));
      }
    });
  }

  start() {
    if (!this.starting) {
      this._spawn();
      this.starting = this._request('start', {}, START_TIMEOUT_MS).then(() => undefined);
      this.starting.catch(() => {});
    }
    return this.starting;
  }

  scan(ms) {
    return this._request('scan', { ms }, (ms || 6000) + SCAN_SLACK_MS);
  }

  connect(id) {
    return this._request('connect', { id }, CONNECT_TIMEOUT_MS);
  }

  write(buf) {
    return this._request('write', { b64: Buffer.from(buf).toString('base64') }, WRITE_TIMEOUT_MS).then(() => undefined);
  }

  pipeStart() {
    return this._request('pipeStart', {}, WRITE_TIMEOUT_MS).then(() => undefined);
  }

  pipeStop() {
    if (this.dead || !this.child) return Promise.resolve();
    return this._request('pipeStop', {}, WRITE_TIMEOUT_MS).then(() => undefined);
  }

  pipeWrite(buf) {
    return this._request('pipeWrite', { b64: Buffer.from(buf).toString('base64') }, WRITE_TIMEOUT_MS).then(() => undefined);
  }

  disconnect() {
    if (this.dead || !this.child) return Promise.resolve();
    return this._request('disconnect', {}, WRITE_TIMEOUT_MS).then(() => undefined);
  }

  kill() {
    this.dead = true;
    for (const p of this.pending.values()) clearTimeout(p.timer);
    this.pending.clear();
    if (this.child) {
      const c = this.child;
      this.child = null;
      c.removeAllListeners('exit');
      try { c.kill(); } catch (_) {}
    }
  }
}

function create() {
  return new HelperTransport();
}

module.exports = { create, HelperTransport, exitError };
