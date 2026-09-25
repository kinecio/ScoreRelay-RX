/**
 * Bluetooth helper process. Owns the radio (via `@stoprocent/noble`) and does
 * nothing else: scan, connect, write, disconnect — all message framing,
 * sign-in and polling live in the parent (`bleLink.js`).
 *
 * It is a separate process on purpose. On macOS, the first Bluetooth call
 * from an app that has not been allowed to use Bluetooth aborts the whole
 * process, and that cannot be caught. Isolating it here means a missing
 * permission costs one helper, never the server that is also driving the
 * live outputs.
 *
 * Launched by `bleTransport.js` over an IPC channel. Requests are
 * `{ reqId, op, ... }` and are answered with `{ reqId, ok, result | error }`;
 * unsolicited events are `{ ev: 'data' | 'disconnected' }`.
 */

'use strict';

const SERVICE = '6e400001b5a3f393e0a9e50e24dcca9e';
const COMMAND = '6e400003b5a3f393e0a9e50e24dcca9e';
const RESPONSE = '6e400004b5a3f393e0a9e50e24dcca9e';
const PIPE = '6e400005b5a3f393e0a9e50e24dcca9e';

const CONNECT_TIMEOUT_MS = 20000;
/** Long: on macOS this is where the user is typing the passkey into the OS dialog. */
const PAIR_TIMEOUT_MS = 120000;
const MTU_WAIT_MS = 1000;
const MAX_WRITE_PAYLOAD = 244;
const MIN_WRITE_PAYLOAD = 20;

let noble = null;
const peripherals = new Map(); // id → noble peripheral
let active = null; // { peripheral, command, pipe? }

function reply(reqId, ok, body) {
  if (!process.send) return;
  process.send(ok ? { reqId, ok: true, result: body } : { reqId, ok: false, error: body });
}

function emit(ev) {
  if (process.send) process.send(ev);
}

function withTimeout(promise, ms, code, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(message), { code })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function classify(err) {
  const message = (err && err.message) || String(err);
  if (err && err.code) return { code: err.code, message };
  if (/auth|encrypt|pair|security|insufficient|not permitted/i.test(message)) {
    return { code: 'not_paired', message };
  }
  return { code: 'ble_error', message };
}

function isScoreRelay(p) {
  const a = p.advertisement || {};
  const uuids = (a.serviceUuids || []).map((u) => String(u).replace(/-/g, '').toLowerCase());
  // Match on the service UUID or the name.
  return uuids.includes(SERVICE) || /^ScoreRelay/i.test(a.localName || '');
}

async function start() {
  if (noble) return {};
  try {
    noble = require('@stoprocent/noble');
  } catch (err) {
    throw Object.assign(new Error('Bluetooth support is not available on this system: ' + err.message), { code: 'bluetooth_unavailable' });
  }
  try {
    await noble.waitForPoweredOnAsync(10000);
  } catch (_) {
    const state = noble.state;
    if (state === 'unauthorized') {
      throw Object.assign(new Error('Bluetooth access was denied. Allow it for this app in your system privacy settings.'), { code: 'permission_denied' });
    }
    if (state === 'poweredOff') {
      throw Object.assign(new Error('Bluetooth is turned off. Turn it on and try again.'), { code: 'bluetooth_unavailable' });
    }
    throw Object.assign(new Error('No usable Bluetooth adapter was found (state: ' + state + ').'), { code: 'bluetooth_unavailable' });
  }
  noble.on('discover', (p) => {
    if (isScoreRelay(p)) peripherals.set(p.id, p);
  });
  return {};
}

async function scan(ms) {
  const seen = new Map();
  const everything = new Set(); // any Bluetooth device at all, to tell "Bluetooth works" from "nothing in range"
  const onDiscover = (p) => {
    everything.add(p.id);
    if (isScoreRelay(p)) seen.set(p.id, p);
  };
  noble.on('discover', onDiscover);
  try {
    await noble.startScanningAsync([], false);
    await new Promise((resolve) => setTimeout(resolve, Math.max(500, Math.min(ms || 6000, 30000))));
  } finally {
    noble.removeListener('discover', onDiscover);
    try { await noble.stopScanningAsync(); } catch (_) {}
  }
  const devices = Array.from(seen.values()).map((p) => {
    const a = p.advertisement || {};
    return { id: p.id, name: a.localName || p.address || p.id, rssi: p.rssi };
  });
  return { devices, seen: everything.size };
}

function payloadFromMtu(mtu) {
  if (!mtu) return MIN_WRITE_PAYLOAD;
  // CoreBluetooth reports the writable payload directly; the other stacks
  // report the ATT MTU, of which 3 bytes are header.
  const payload = process.platform === 'darwin' ? mtu : mtu - 3;
  return Math.max(MIN_WRITE_PAYLOAD, Math.min(payload, MAX_WRITE_PAYLOAD));
}

async function connect(id) {
  const peripheral = peripherals.get(id);
  if (!peripheral) {
    throw Object.assign(new Error('That device is not in range. Scan again and pick it from the list.'), { code: 'not_found' });
  }
  await disconnect();

  await withTimeout(peripheral.connectAsync(), CONNECT_TIMEOUT_MS, 'connect_timeout', 'Could not connect to the device (timed out).');
  peripheral.once('disconnect', (reason) => {
    if (active && active.peripheral === peripheral) active = null;
    emit({ ev: 'disconnected', reason: reason == null ? '' : String(reason) });
  });

  try {
    const { characteristics } = await withTimeout(
      peripheral.discoverSomeServicesAndCharacteristicsAsync([SERVICE], [COMMAND, RESPONSE, PIPE]),
      CONNECT_TIMEOUT_MS,
      'connect_timeout',
      'The device did not expose the ScoreRelay service.'
    );
    const command = characteristics.find((c) => c.uuid === COMMAND);
    const response = characteristics.find((c) => c.uuid === RESPONSE);
    if (!command || !response) {
      throw Object.assign(new Error('The device did not expose the ScoreRelay service.'), { code: 'not_scorerelay' });
    }
    response.on('data', (buf) => emit({ ev: 'data', b64: Buffer.from(buf).toString('base64') }));
    // On some systems this is where the operating system asks the user to
    // pair, so it can legitimately take a while.
    await withTimeout(response.subscribeAsync(), PAIR_TIMEOUT_MS, 'pair_timeout', 'Pairing did not finish in time.');

    if (!peripheral.mtu) {
      await new Promise((resolve) => {
        const t = setTimeout(resolve, MTU_WAIT_MS);
        peripheral.once('mtu', () => { clearTimeout(t); resolve(); });
      });
    }
    // Older devices have no pipe; everything else still works without it.
    const pipe = characteristics.find((c) => c.uuid === PIPE) || null;
    active = { peripheral, command, pipe, pipeListening: false };
    return { writePayload: payloadFromMtu(peripheral.mtu), pipe: !!pipe };
  } catch (err) {
    try { await peripheral.disconnectAsync(); } catch (_) {}
    throw err;
  }
}

async function write(b64) {
  if (!active) throw Object.assign(new Error('Not connected'), { code: 'disconnected' });
  // Write with response, so a refused write is reported rather than silent.
  await active.command.writeAsync(Buffer.from(b64, 'base64'), false);
  return {};
}

async function pipeStart() {
  if (!active || !active.pipe) throw Object.assign(new Error('This device does not support the cloud relay.'), { code: 'no_pipe' });
  if (!active.pipeListening) {
    active.pipe.on('data', (buf) => emit({ ev: 'pipe', b64: Buffer.from(buf).toString('base64') }));
    active.pipeListening = true;
  }
  await active.pipe.subscribeAsync();
  return {};
}

async function pipeStop() {
  if (!active || !active.pipe) return {};
  try { await active.pipe.unsubscribeAsync(); } catch (_) {}
  return {};
}

async function pipeWrite(b64) {
  if (!active || !active.pipe) throw Object.assign(new Error('Not connected'), { code: 'disconnected' });
  await active.pipe.writeAsync(Buffer.from(b64, 'base64'), false);
  return {};
}

async function disconnect() {
  if (!active) return {};
  const { peripheral } = active;
  active = null;
  try { await peripheral.disconnectAsync(); } catch (_) {}
  return {};
}

// One operation at a time: the radio is not re-entrant and the requests are
// ordered (connect, then writes).
let chain = Promise.resolve();

process.on('message', (msg) => {
  if (!msg || typeof msg.reqId !== 'number') return;
  const run = async () => {
    try {
      let result;
      if (msg.op === 'start') result = await start();
      else if (msg.op === 'scan') result = await scan(msg.ms);
      else if (msg.op === 'connect') result = await connect(msg.id);
      else if (msg.op === 'write') result = await write(msg.b64);
      else if (msg.op === 'pipeStart') result = await pipeStart();
      else if (msg.op === 'pipeStop') result = await pipeStop();
      else if (msg.op === 'pipeWrite') result = await pipeWrite(msg.b64);
      else if (msg.op === 'disconnect') result = await disconnect();
      else throw new Error('unknown op ' + msg.op);
      reply(msg.reqId, true, result);
    } catch (err) {
      reply(msg.reqId, false, classify(err));
    }
  };
  chain = chain.then(run, run);
});

// Never outlive the server that started us.
process.on('disconnect', () => process.exit(0));
