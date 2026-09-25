'use strict';

// Tests for the server-side USB link (src/usbLink.js) using a fake serial
// transport, plus a fake tunnel socket — no device and no cloud required.

const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');

// Stub the aggregator so STATE frames are observable without touching disk.
const aggPath = require.resolve('../src/dataAggregator');
const updates = [];
require.cache[aggPath] = {
  id: aggPath,
  filename: aggPath,
  loaded: true,
  exports: { update: (key, value) => updates.push([key, value]) },
};

const Usb = require('../src/usbFrame');
const usbLink = require('../src/usbLink');
const usbTunnel = require('../src/usbTunnel');

class FakeSerialPort extends EventEmitter {
  static list() {
    return Promise.resolve([{ path: '/dev/ttyFAKE0', manufacturer: 'ScoreRelay' }]);
  }

  constructor(options) {
    super();
    FakeSerialPort.instances.push(this);
    this.options = options;
    this.isOpen = false;
    this.writes = [];
  }

  open(cb) {
    setImmediate(() => {
      this.isOpen = true;
      this.emit('open');
      if (cb) cb(null);
    });
  }

  close(cb) {
    this.isOpen = false;
    this.emit('close');
    if (cb) cb();
  }

  write(chunk) {
    this.writes.push(Buffer.from(chunk));
    return true;
  }
}

FakeSerialPort.instances = [];

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.destroyed = false;
    this.writable = true;
    this.writes = [];
  }

  write(chunk) {
    this.writes.push(Buffer.from(chunk));
    return true;
  }

  destroy() {
    this.destroyed = true;
    this.emit('close');
  }
}

function decodeCtrl(frame) {
  assert.strictEqual(frame.channel, Usb.CH_CTRL);
  return JSON.parse(frame.payload.toString('utf8'));
}

test('open sends hello, streams state, and advertises the tunnel destination', async () => {
  const sockets = [];
  usbTunnel.setConnector(() => {
    const s = new FakeSocket();
    sockets.push(s);
    return s;
  });

  let lastPort = null;
  FakeSerialPort.instances = [];
  usbLink.setTransportFactory(() => FakeSerialPort);

  const ports = await usbLink.listPorts();
  assert.deepStrictEqual(ports, [{ path: '/dev/ttyFAKE0', label: 'ScoreRelay', manufacturer: 'ScoreRelay', serialNumber: '' }]);

  const opened = await usbLink.open('/dev/ttyFAKE0');
  assert.strictEqual(opened, true);
  assert.strictEqual(usbLink.isConnected(), true);
  lastPort = FakeSerialPort.instances[FakeSerialPort.instances.length - 1];

  // The first thing written is the hello control frame.
  const first = new Usb.UsbFrameParser().feed(lastPort.writes[0]);
  assert.deepStrictEqual(decodeCtrl(first[0]), { t: 'hello' });

  // Device replies with firmware/sport and a tunnel destination.
  updates.length = 0;
  const hello = Usb.buildCtrlFrame({ t: 'hello', fw: '2.1.0', sport: 'soccer', tunnel: { host: 'cloud.invalid', port: 4443 } });
  lastPort.emit('data', Buffer.concat([hello, Usb.buildFrame(Usb.CH_STATE, Buffer.from(JSON.stringify({ type: 'state', sport: 'soccer', data: { home_score: 2 } })))]));

  await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(updates, [['sport', 'soccer'], ['home_score', '2']]);
  const stats = usbLink.getStats();
  assert.strictEqual(stats.firmware, '2.1.0');
  assert.strictEqual(stats.tunnel.configured, true);
  assert.strictEqual(stats.messageCount, 1);

  // A PIPE frame dials the advertised destination and forwards the bytes.
  lastPort.emit('data', Usb.buildFrame(Usb.CH_PIPE, Buffer.from('tls-bytes')));
  assert.strictEqual(sockets.length, 1);
  sockets[0].emit('connect');
  assert.deepStrictEqual(sockets[0].writes.map(String), ['tls-bytes']);

  // Cloud bytes come back onto the link as a PIPE frame.
  lastPort.writes.length = 0;
  sockets[0].emit('data', Buffer.from('cloud-bytes'));
  const back = new Usb.UsbFrameParser().feed(lastPort.writes[0]);
  assert.strictEqual(back[0].channel, Usb.CH_PIPE);
  assert.strictEqual(back[0].payload.toString('utf8'), 'cloud-bytes');

  usbLink.close();
  assert.strictEqual(usbLink.isConnected(), false);
  usbTunnel.setConnector(null);
  usbLink.setTransportFactory(null);
});

test('open rejects when the transport fails, and close is safe with no port', async () => {
  class FailingPort extends FakeSerialPort {
    open(cb) {
      setImmediate(() => cb(new Error('device busy')));
    }
  }
  usbLink.setTransportFactory(() => FailingPort);
  const ok = await usbLink.open('/dev/ttyNOPE');
  assert.strictEqual(ok, false);
  assert.match(usbLink.getStats().lastError, /device busy/);
  usbLink.close();
  assert.doesNotThrow(() => usbLink.close());
  usbLink.setTransportFactory(null);
});
