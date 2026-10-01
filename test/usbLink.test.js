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
  assert.deepStrictEqual(ports, [{
    path: '/dev/ttyFAKE0', label: 'ScoreRelay', manufacturer: 'ScoreRelay', serialNumber: '',
    vendorId: '', productId: '', likelyReceiver: false,
  }]);

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

// ---- wireless receiver -----------------------------------------------------

async function openFake() {
  FakeSerialPort.instances = [];
  usbLink.setTransportFactory(() => FakeSerialPort);
  await usbLink.open('/dev/ttyFAKE0');
  return FakeSerialPort.instances[FakeSerialPort.instances.length - 1];
}

function rxStatus(extra) {
  return Usb.buildCtrlFrame({
    t: 'rx_status', fw: '0.1.0', mac: 'aa:bb:cc:dd:ee:01', configured: true, running: true, radio_ok: true,
    channel: 6, link: true, sender: '11:22:33:44:55:66', rssi: -52, age_ms: 120, backlog: 0,
    frames_rx: 10, frames_tx: 9, retransmits: 2, auth_fail: 0, resets: 1, sender_reboots: 0, dropped: 3, ...extra,
  });
}

test('a Espressif USB serial port is flagged as a likely wireless receiver', async () => {
  class EspPort extends FakeSerialPort {
    static list() {
      return Promise.resolve([
        { path: '/dev/ttyESP', vendorId: '303A', productId: '1001' },
        { path: '/dev/ttyOTHER', vendorId: '0403', productId: '6001' },
      ]);
    }
  }
  usbLink.setTransportFactory(() => EspPort);
  const ports = await usbLink.listPorts();
  assert.deepStrictEqual(ports.map((p) => p.likelyReceiver), [true, false]);
  usbLink.setTransportFactory(null);
});

test('receiver status is reported in user-level terms, and absent for a plain device', async () => {
  const port = await openFake();
  assert.strictEqual(usbLink.getStats().receiver, null);

  port.emit('data', rxStatus());
  const r = usbLink.getStats().receiver;
  assert.deepStrictEqual(r, {
    address: 'aa:bb:cc:dd:ee:01', paired: true, radioReady: true, channel: 6, linked: true,
    deviceAddress: '11:22:33:44:55:66', signal: -52, lastHeardMs: 120, firmware: '0.1.0',
    resends: 2, restarts: 1, dropped: 3,
  });

  port.emit('data', rxStatus({ link: false, sender: '', age_ms: -1 }));
  const down = usbLink.getStats().receiver;
  assert.strictEqual(down.linked, false);
  assert.strictEqual(down.lastHeardMs, null);

  usbLink.close();
  assert.strictEqual(usbLink.getStats().receiver, null, 'closing forgets the receiver');
  usbLink.setTransportFactory(null);
});

test('receiverSet sends the pairing request and resolves with the one-time key', async () => {
  const port = await openFake();
  await assert.rejects(usbLink.receiverSet({ generateKey: true }), /not a wireless receiver/);

  port.emit('data', rxStatus());
  port.writes.length = 0;
  const pending = usbLink.receiverSet({ generateKey: true, channel: '11' });
  const sent = decodeCtrl(new Usb.UsbFrameParser().feed(port.writes[0])[0]);
  assert.deepStrictEqual(sent, { t: 'rx_set', generate_key: true, channel: 11 });

  port.emit('data', Usb.buildCtrlFrame({ t: 'rx_set', ok: true, applies: 'restart', key: '00112233445566778899aabbccddeeff' }));
  assert.deepStrictEqual(await pending, { key: '00112233445566778899aabbccddeeff', restarts: true });

  // a refusal from the unit becomes an error with its own words
  const refused = usbLink.receiverSet({ key: 'nothex' });
  port.emit('data', Usb.buildCtrlFrame({ t: 'rx_set', ok: false, error: 'key must be exactly 32 hex digits' }));
  await assert.rejects(refused, /32 hex digits/);

  await assert.rejects(usbLink.receiverSet({}), /Give a key/);
  usbLink.close();
  usbLink.setTransportFactory(null);
});

test('a hello drops the old cloud socket so the device starts a fresh connection', async () => {
  const sockets = [];
  usbTunnel.setConnector(() => {
    const s = new FakeSocket();
    sockets.push(s);
    return s;
  });
  const port = await openFake();
  const hello = Usb.buildCtrlFrame({ t: 'hello', fw: '2.1.0', sport: 'soccer', tunnel: { host: 'cloud.invalid', port: 4443 } });
  port.emit('data', hello);
  port.emit('data', Usb.buildFrame(Usb.CH_PIPE, Buffer.from('first-session')));
  assert.strictEqual(sockets.length, 1);
  sockets[0].emit('connect');

  // The radio link restarted: the device says hello again and begins a new handshake.
  port.emit('data', hello);
  assert.strictEqual(sockets[0].destroyed, true, 'the stale connection is closed');
  port.emit('data', Usb.buildFrame(Usb.CH_PIPE, Buffer.from('second-session')));
  assert.strictEqual(sockets.length, 2, 'the new handshake gets its own connection');
  sockets[1].emit('connect');
  assert.deepStrictEqual(sockets[1].writes.map(String), ['second-session']);

  usbLink.close();
  usbTunnel.setConnector(null);
  usbLink.setTransportFactory(null);
});
