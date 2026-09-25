'use strict';

// Tests for the Bluetooth session (src/bleLink.js) against a fake radio and a
// fake device that behaves like the real one at the message level: it
// reassembles chunked requests, answers one request at a time, and replies in
// chunks. No hardware and no helper process.

const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');

// Stub the aggregator so state updates are observable without touching disk.
const aggPath = require.resolve('../src/dataAggregator');
const updates = [];
require.cache[aggPath] = {
  id: aggPath,
  filename: aggPath,
  loaded: true,
  exports: { update: (key, value) => updates.push([key, value]) },
};

const { encodeRequest, ReplyAssembler } = require('../src/bleFrame');
const bleLink = require('../src/bleLink');

const PASSWORD = 'correct horse';

class FakeDevice {
  constructor(opts = {}) {
    this.password = opts.password || PASSWORD;
    this.mustChange = !!opts.mustChange;
    this.requests = [];
    this.inFlight = 0;
    this.maxInFlight = 0;
    this.busyOnce = !!opts.busyOnce;
    this.replyChunk = opts.replyChunk || 90;
    this.loggedIn = false;
    this.tunnel = opts.tunnel === undefined ? { enabled: true, provisioned: true, tunnel: { host: 'relay.invalid', port: 4443 } } : opts.tunnel;
    this.oldFirmware = !!opts.oldFirmware;
    this.state = { v: 1, seq: 1, type: 'state', sport: 'basketball', fields: { home_score: '10', away_score: '8', clock: '12:34' } };
    this.assembler = new ReplyAssembler();
  }

  // Bytes written by the client.
  receive(bytes, reply) {
    for (const text of this.assembler.feed(bytes)) {
      const req = JSON.parse(text);
      this.requests.push(req);
      this.inFlight++;
      this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
      setImmediate(() => {
        this.inFlight--;
        reply(this.handle(req));
      });
    }
  }

  handle(req) {
    const ok = (result) => ({ id: req.id, ok: true, result });
    const err = (code, message) => ({ id: req.id, ok: false, error: { code, message } });
    if (this.busyOnce && req.method === 'getState') {
      this.busyOnce = false;
      return err('busy', 'busy');
    }
    switch (req.method) {
      case 'login':
        if (req.params.password !== this.password) return err('unauthorized', 'Invalid password');
        this.loggedIn = true;
        return ok({ status: 'success', must_change_password: this.mustChange });
      case 'changePassword':
        if (req.params.current_password !== this.password) return err('unauthorized', 'Current password incorrect');
        this.password = req.params.new_password;
        this.mustChange = false;
        return ok({ status: 'success' });
      case 'getStatus':
        return ok({ device_id: 'scorerelay0001', firmware_version: '1.2.3', wifi_sta_ip: '10.0.0.5' });
      case 'getState':
        if (!this.loggedIn) return err('unauthorized', 'login required');
        if (this.mustChange) return err('must_change_password', 'change the password first');
        return ok(this.state);
      case 'getTunnelInfo':
        if (this.oldFirmware) return err('unknown_method', 'getTunnelInfo');
        return ok(this.tunnel);
      case 'setTunnel':
        this.tunnel = { enabled: !!req.params.enabled, provisioned: true, tunnel: { host: 'relay.invalid', port: 4443 } };
        return ok({ status: 'success', applies: 'after_restart' });
      case 'reboot':
        this.rebooted = true;
        return null;
      case 'scanWifi':
        return ok({ networks: [{ ssid: 'Venue', rssi: -50, auth: 3 }] });
      default:
        return err('unknown_method', req.method);
    }
  }
}

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.destroyed = false;
    this.writable = true;
    this.written = [];
    setImmediate(() => this.emit('connect'));
  }

  write(chunk) { this.written.push(Buffer.from(chunk)); return true; }
  destroy() { this.destroyed = true; this.writable = false; }
}

class FakeRadio extends EventEmitter {
  constructor(device, opts = {}) {
    super();
    this.device = device;
    this.opts = opts;
    this.connected = false;
    this.connects = 0;
    this.killed = false;
  }

  async start() {
    if (this.opts.startError) throw this.opts.startError;
  }

  async scan() {
    return { devices: [{ id: 'dev-1', name: 'ScoreRelay-0001', rssi: -55 }], seen: 4 };
  }

  async connect() {
    this.connects++;
    if (this.opts.connectError) throw this.opts.connectError;
    this.connected = true;
    this.device.loggedIn = false; // every new link starts signed out
    return { writePayload: this.opts.writePayload || 182, pipe: this.opts.pipe !== false };
  }

  async pipeStart() {
    this.pipeStarts = (this.pipeStarts || 0) + 1;
    this.pipeOn = true;
  }

  async pipeStop() {
    this.pipeOn = false;
  }

  async pipeWrite(buf) {
    if (!this.pipeOn) throw new Error('pipe not subscribed');
    (this.pipeWrites = this.pipeWrites || []).push(Buffer.from(buf));
  }

  async write(buf) {
    if (!this.connected) throw new Error('not connected');
    if (this.opts.writeError) throw this.opts.writeError;
    this.device.receive(buf, (reply) => this.notify(reply));
  }

  notify(message) {
    if (!message || !this.connected) return;
    const bytes = Buffer.from(JSON.stringify(message));
    if (bytes.length <= this.device.replyChunk) {
      this.emit('data', bytes);
      return;
    }
    // Device-style chunked reply.
    const room = this.device.replyChunk - 6;
    for (let off = 0, seq = 0; off < bytes.length; off += room, seq++) {
      const frag = bytes.subarray(off, off + room);
      const h = Buffer.alloc(6);
      h[0] = 0xff; h[1] = 1; h.writeUInt16BE(bytes.length, 2); h.writeUInt16BE(seq, 4);
      this.emit('data', Buffer.concat([h, frag]));
    }
  }

  async disconnect() {
    this.connected = false;
  }

  drop(reason) {
    this.connected = false;
    this.emit('disconnected', reason || 'link loss');
  }

  kill() {
    this.killed = true;
  }
}

function setup(deviceOpts, radioOpts) {
  const device = new FakeDevice(deviceOpts);
  const radio = new FakeRadio(device, radioOpts);
  bleLink.setTransportFactory(() => radio);
  bleLink.setTimings({ pollMs: 15, reconnectMs: 20 });
  const sockets = [];
  const dialed = [];
  bleLink.setTunnelConnector((host, port) => {
    dialed.push(host + ':' + port);
    const s = new FakeSocket();
    sockets.push(s);
    return s;
  });
  radio.sockets = sockets;
  radio.dialed = dialed;
  updates.length = 0;
  return { device, radio };
}

const until = async (fn, ms = 2000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 5));
  }
};

test.afterEach(() => bleLink.shutdown());

test('scan returns nearby devices', async () => {
  setup();
  const found = await bleLink.scan(100);
  assert.deepStrictEqual(found.devices.map((d) => d.name), ['ScoreRelay-0001']);
  assert.strictEqual(found.seen, 4);
});

test('connects, signs in, and feeds live scoreboard fields to the outputs', async () => {
  const { device } = setup();
  const result = await bleLink.open({ id: 'dev-1', name: 'ScoreRelay-0001', adminPassword: PASSWORD });
  assert.deepStrictEqual(result, { success: true });
  assert.strictEqual(bleLink.isConnected(), true);

  await until(() => updates.some(([k]) => k === 'home_score'));
  assert.ok(updates.some(([k, v]) => k === 'sport' && v === 'basketball'));
  assert.ok(updates.some(([k, v]) => k === 'home_score' && v === '10'));
  assert.ok(updates.some(([k, v]) => k === 'clock' && v === '12:34'));
  // The envelope itself must never leak in as a "field".
  assert.ok(!updates.some(([k]) => k === 'fields' || k === 'v'));

  const stats = bleLink.getStats();
  assert.strictEqual(stats.connected, true);
  assert.strictEqual(stats.phase, 'connected');
  assert.strictEqual(stats.device.deviceId, 'scorerelay0001');
  assert.ok(stats.messageCount >= 1);
  assert.strictEqual(device.maxInFlight, 1, 'the device must only ever see one request at a time');
});

test('works over a minimum-size link where every request is chunked', async () => {
  const { device } = setup({}, { writePayload: 20 });
  const result = await bleLink.open({ id: 'dev-1', adminPassword: PASSWORD });
  assert.strictEqual(result.success, true);
  await until(() => updates.some(([k]) => k === 'home_score'));
  assert.ok(device.requests.some((r) => r.method === 'login'));
});

test('a wrong password fails cleanly and is not retried', async () => {
  const { device, radio } = setup();
  const result = await bleLink.open({ id: 'dev-1', adminPassword: 'nope' });
  assert.strictEqual(result.success, false);
  assert.match(result.error, /Invalid password/);
  assert.strictEqual(bleLink.isConnected(), false);
  await new Promise((r) => setTimeout(r, 150));
  assert.strictEqual(device.requests.filter((r) => r.method === 'login').length, 1);
  assert.strictEqual(radio.connects, 1);
});

test('an unpaired computer is told how to pair, not shown a raw stack error', async () => {
  setup({}, { writeError: new Error('Insufficient Authentication') });
  const result = await bleLink.open({ id: 'dev-1', adminPassword: PASSWORD });
  assert.strictEqual(result.success, false);
  assert.match(result.error, /not paired/i);
  assert.match(result.error, /passkey/i);
  assert.strictEqual(bleLink.getStats().lastErrorCode, 'not_paired');
});

test('a default password blocks polling until it is changed, and the new one is kept', async () => {
  const { device, radio } = setup({ mustChange: true });
  const result = await bleLink.open({ id: 'dev-1', adminPassword: PASSWORD });
  assert.strictEqual(result.success, true);
  assert.strictEqual(bleLink.getStats().mustChangePassword, true);
  assert.strictEqual(bleLink.getStats().phase, 'password_change_required');
  await new Promise((r) => setTimeout(r, 100));
  assert.strictEqual(updates.length, 0, 'no data may be requested while the password change is pending');
  assert.ok(!device.requests.some((r) => r.method === 'getState'));

  await bleLink.changePassword(PASSWORD, 'a brand new pw');
  assert.strictEqual(bleLink.getStats().mustChangePassword, false);
  await until(() => updates.some(([k]) => k === 'home_score'));

  // The stored password followed the change, so a reconnect signs in again.
  radio.drop();
  await until(() => radio.connects === 2 && bleLink.isConnected());
  assert.ok(device.requests.filter((r) => r.method === 'login').pop().params.password === 'a brand new pw');
});

test('a dropped link reconnects on its own, signs back in, and resumes data', async () => {
  const { radio } = setup();
  await bleLink.open({ id: 'dev-1', adminPassword: PASSWORD });
  await until(() => updates.some(([k]) => k === 'home_score'));
  updates.length = 0;

  radio.drop();
  await until(() => radio.connects === 2 && bleLink.isConnected());
  await until(() => updates.some(([k]) => k === 'home_score'));
  assert.strictEqual(bleLink.getStats().lastError, null);
});

test('a "busy" reply is retried transparently', async () => {
  const { device } = setup({ busyOnce: true });
  await bleLink.open({ id: 'dev-1', adminPassword: PASSWORD });
  await until(() => updates.some(([k]) => k === 'home_score'));
  assert.ok(device.requests.filter((r) => r.method === 'getState').length >= 2);
  assert.strictEqual(bleLink.getStats().lastError, null);
});

test('management requests share the link with polling, and only allowed ones run', async () => {
  const { device } = setup();
  await bleLink.open({ id: 'dev-1', adminPassword: PASSWORD });

  const results = await Promise.all([
    bleLink.call('scanWifi'),
    bleLink.call('getStatus'),
    bleLink.call('scanWifi'),
  ]);
  assert.strictEqual(results[0].networks[0].ssid, 'Venue');
  assert.strictEqual(results[1].device_id, 'scorerelay0001');
  assert.strictEqual(device.maxInFlight, 1);

  for (const method of ['login', 'someOtherMethod', 'anotherMethod']) {
    await assert.rejects(() => bleLink.call(method), (e) => e.code === 'not_allowed');
  }
  assert.ok(!device.requests.some((r) => ['someOtherMethod', 'anotherMethod'].includes(r.method)));
});

test('management calls are refused when nothing is connected', async () => {
  setup();
  await assert.rejects(() => bleLink.call('getStatus'), (e) => e.code === 'disconnected');
});

test('a missing Bluetooth permission is reported with what to do about it', async () => {
  const err = Object.assign(new Error('macOS did not allow Bluetooth for this app.'), { code: 'permission_denied' });
  setup({}, { startError: err });
  const result = await bleLink.open({ id: 'dev-1', adminPassword: PASSWORD });
  assert.strictEqual(result.success, false);
  assert.match(result.error, /allow Bluetooth/i);
  assert.strictEqual(bleLink.getStats().phase, 'error');
});

test('disconnecting stops polling and forgets the password', async () => {
  const { device } = setup();
  await bleLink.open({ id: 'dev-1', adminPassword: PASSWORD });
  await until(() => updates.length > 0);
  bleLink.close();
  const seen = device.requests.length;
  await new Promise((r) => setTimeout(r, 100));
  assert.strictEqual(device.requests.length, seen, 'no requests after disconnect');
  assert.strictEqual(bleLink.isConnected(), false);
  assert.strictEqual(bleLink.getStats().phase, 'idle');
});

test('a reboot whose reply is lost to the restart still counts as done', async () => {
  const { device, radio } = setup();
  await bleLink.open({ id: 'dev-1', adminPassword: PASSWORD });
  await until(() => updates.length > 0);
  const original = device.handle.bind(device);
  // Like the real device: no reply, the link just goes away.
  device.handle = (req) => {
    if (req.method !== 'reboot') return original(req);
    setImmediate(() => radio.drop('device restarting'));
    return null;
  };
  assert.deepStrictEqual(await bleLink.call('reboot'), { status: 'ok' });
  // ...and the session recovers by itself afterwards.
  device.handle = original;
  await until(() => radio.connects === 2 && bleLink.isConnected());
});

// -- cloud relay over the pipe ---------------------------------------------

test('relay: dials the destination the device names and moves bytes both ways', async () => {
  const { radio } = setup({}, { writePayload: 40 });
  await bleLink.open({ id: 'dev-1', adminPassword: PASSWORD });
  await until(() => bleLink.getStats().relay.state === 'active');
  assert.strictEqual(radio.pipeOn, true);

  // Device -> cloud: bytes arrive on the pipe, are written to the socket.
  radio.emit('pipe', Buffer.from('hello-from-device'));
  await until(() => radio.sockets.length === 1);
  assert.deepStrictEqual(radio.dialed, ['relay.invalid:4443']);
  await until(() => radio.sockets[0].written.length > 0);
  assert.strictEqual(Buffer.concat(radio.sockets[0].written).toString(), 'hello-from-device');

  // Cloud -> device: socket data is chunked to the link size and kept in order.
  const payload = Buffer.alloc(200);
  for (let i = 0; i < payload.length; i++) payload[i] = i;
  radio.sockets[0].emit('data', payload);
  await until(() => Buffer.concat(radio.pipeWrites || []).length === 200);
  assert.ok(radio.pipeWrites.every((w) => w.length <= 40));
  assert.ok(radio.pipeWrites.length >= 5);
  assert.deepStrictEqual(Buffer.concat(radio.pipeWrites), payload);
  assert.strictEqual(bleLink.getStats().relay.connected, true);
});

test('relay: never exposes where it connects to', async () => {
  const { radio } = setup();
  await bleLink.open({ id: 'dev-1', adminPassword: PASSWORD });
  await until(() => bleLink.getStats().relay.state === 'active');
  radio.emit('pipe', Buffer.from('x'));
  await until(() => radio.sockets.length === 1);
  const dump = JSON.stringify(bleLink.getStats());
  assert.ok(!dump.includes('relay.invalid'), 'destination leaked into stats');
  assert.ok(!dump.includes('4443'), 'port leaked into stats');
});

test('relay: stays off, and dials nothing, when the device has it disabled', async () => {
  const { radio } = setup({ tunnel: { enabled: false, provisioned: true } });
  await bleLink.open({ id: 'dev-1', adminPassword: PASSWORD });
  await until(() => bleLink.getStats().relay.state === 'not_enabled');
  assert.ok(!radio.pipeOn);
  assert.strictEqual(radio.dialed.length, 0);
});

test('relay: a unit with no cloud credentials is reported, not dialled', async () => {
  const { radio } = setup({ tunnel: { enabled: true, provisioned: false } });
  await bleLink.open({ id: 'dev-1', adminPassword: PASSWORD });
  await until(() => bleLink.getStats().relay.state === 'not_provisioned');
  assert.ok(!radio.pipeOn);
  assert.strictEqual(radio.dialed.length, 0);
});

test('relay: a device without the pipe still connects and streams data', async () => {
  setup({}, { pipe: false });
  const result = await bleLink.open({ id: 'dev-1', adminPassword: PASSWORD });
  assert.strictEqual(result.success, true);
  assert.strictEqual(bleLink.getStats().relay.state, 'unsupported');
  await until(() => updates.some(([k]) => k === 'home_score'));
});

test('relay: older firmware that rejects the request is "unsupported", not a fault', async () => {
  setup({ oldFirmware: true });
  const result = await bleLink.open({ id: 'dev-1', adminPassword: PASSWORD });
  assert.strictEqual(result.success, true);
  await until(() => bleLink.getStats().relay.state === 'unsupported');
  assert.strictEqual(bleLink.getStats().lastError, null);
});

test('relay: waits for the default password to be changed before starting', async () => {
  const { radio } = setup({ mustChange: true });
  await bleLink.open({ id: 'dev-1', adminPassword: PASSWORD });
  await new Promise((r) => setTimeout(r, 60));
  assert.strictEqual(bleLink.getStats().relay.state, 'off');
  assert.ok(!radio.pipeOn);
  await bleLink.changePassword(PASSWORD, 'another good pw');
  await until(() => bleLink.getStats().relay.state === 'active');
});

test('relay: enabling it sets the tunnel, restarts the device, and comes up after reconnect', async () => {
  const { device, radio } = setup({ tunnel: { enabled: false, provisioned: true } });
  await bleLink.open({ id: 'dev-1', adminPassword: PASSWORD });
  await until(() => bleLink.getStats().relay.state === 'not_enabled');

  // The device restarts after acknowledging: the link goes away, no reply.
  const originalHandle = device.handle.bind(device);
  device.handle = (req) => {
    const r = originalHandle(req);
    if (req.method === 'reboot') setImmediate(() => radio.drop('device restarting'));
    return r;
  };
  await bleLink.setRelay(true);
  assert.ok(device.requests.some((r) => r.method === 'setTunnel' && r.params.enabled === true));
  assert.ok(device.rebooted);
  await until(() => radio.connects === 2 && bleLink.getStats().relay.state === 'active');
  assert.strictEqual(radio.pipeStarts, 1);
});

test('relay: does not survive a dropped link; it is set up again on reconnect', async () => {
  const { radio } = setup();
  await bleLink.open({ id: 'dev-1', adminPassword: PASSWORD });
  await until(() => bleLink.getStats().relay.state === 'active');
  radio.drop();
  await until(() => radio.connects === 2 && bleLink.getStats().relay.state === 'active');
  assert.strictEqual(radio.pipeStarts, 2);
});

test('relay: cannot be toggled on a device without the pipe or when signed out', async () => {
  setup({}, { pipe: false });
  await assert.rejects(() => bleLink.setRelay(true), (e) => e.code === 'disconnected');
  await bleLink.open({ id: 'dev-1', adminPassword: PASSWORD });
  await assert.rejects(() => bleLink.setRelay(true), (e) => e.code === 'unsupported');
});
