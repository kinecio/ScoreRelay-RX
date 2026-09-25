'use strict';

// Protocol tests for the USB link framing (src/usbFrame.js). No device
// needed — these lock down the wire format the device and the host share,
// including resync after a truncated/corrupted read.

const test = require('node:test');
const assert = require('node:assert');

const Usb = require('../src/usbFrame.js');

function hex(bytes) {
  return Buffer.from(bytes).toString('hex');
}

function bytesFromPayload(str) {
  return new TextEncoder().encode(str);
}

test('CRC-16/CCITT known vector', () => {
  assert.strictEqual(Usb.crc16(bytesFromPayload('123456789')), 0x29b1);
  assert.strictEqual(Usb.crc16(new Uint8Array(0)), 0xffff);
});

test('golden control-frame bytes', () => {
  const frame = Usb.buildCtrlFrame({ t: 'hello' });
  assert.strictEqual(hex(frame), '005352030d007b2274223a2268656c6c6f227deec7');
});

function parseAll(stream, splitAt) {
  const parser = new Usb.UsbFrameParser();
  const out = [];
  if (splitAt == null) {
    return parser.feed(stream);
  }
  out.push(...parser.feed(stream.slice(0, splitAt)));
  out.push(...parser.feed(stream.slice(splitAt)));
  return out;
}

test('round-trips every channel', () => {
  const state = bytesFromPayload(JSON.stringify({ type: 'state', sport: 'basketball' }));
  const ctrl = bytesFromPayload(JSON.stringify({ t: 'ping' }));
  for (const [channel, payload] of [[Usb.CH_STATE, state], [Usb.CH_CTRL, ctrl]]) {
    const frames = parseAll(Usb.buildFrame(channel, payload));
    assert.strictEqual(frames.length, 1);
    assert.strictEqual(frames[0].channel, channel);
    assert.deepStrictEqual(Array.from(frames[0].payload), Array.from(payload));
  }
});

test('multiple frames survive a single read and every split point', () => {
  const stream = Buffer.concat([
    Buffer.from(Usb.buildFrame(Usb.CH_STATE, bytesFromPayload('{"type":"state","sport":"soccer"}'))),
    Buffer.from(Usb.buildFrame(Usb.CH_CTRL, bytesFromPayload('{"t":"hello"}'))),
    Buffer.from(Usb.buildFrame(Usb.CH_STATE, bytesFromPayload('{"type":"heartbeat"}'))),
  ]);
  assert.strictEqual(parseAll(stream).length, 3);
  for (let split = 0; split <= stream.length; split++) {
    assert.strictEqual(parseAll(stream, split).length, 3, `split at ${split}`);
  }
});

test('recovers a frame after a false lead-in', () => {
  const good = Buffer.from(Usb.buildFrame(Usb.CH_CTRL, bytesFromPayload('{"t":"hello"}')));
  // A stray 0x00 'S' 'R' prefix must not swallow the real frame's header.
  const stream = Buffer.concat([Buffer.from([0x00, 0x53, 0x52]), good]);
  const frames = parseAll(stream);
  assert.strictEqual(frames.length, 1);
  assert.strictEqual(Buffer.from(frames[0].payload).toString('utf8'), '{"t":"hello"}');
});

test('recovers a frame after a truncated one', () => {
  const hello = Buffer.from(Usb.buildFrame(Usb.CH_CTRL, bytesFromPayload('{"t":"hello"}')));
  const ping = Buffer.from(Usb.buildFrame(Usb.CH_CTRL, bytesFromPayload('{"t":"ping"}')));
  // Drop hello's last checksum byte (non-zero CRC high byte, so the next
  // frame's lead-in cannot accidentally complete it).
  const stream = Buffer.concat([hello.slice(0, hello.length - 1), ping]);
  const frames = parseAll(stream);
  assert.strictEqual(frames.length, 1);
  assert.strictEqual(Buffer.from(frames[0].payload).toString('utf8'), '{"t":"ping"}');
});

test('drops a bad checksum and keeps scanning', () => {
  const bad = Buffer.from(Usb.buildFrame(Usb.CH_STATE, bytesFromPayload('{"type":"state"}')));
  bad[bad.length - 2] ^= 0xff;
  const good = Buffer.from(Usb.buildFrame(Usb.CH_CTRL, bytesFromPayload('{"t":"hello"}')));
  const frames = parseAll(Buffer.concat([bad, good]));
  assert.strictEqual(frames.length, 1);
  assert.strictEqual(frames[0].channel, Usb.CH_CTRL);
});

test('rejects an oversized length without overrunning', () => {
  const bad = Buffer.from([0x00, 0x53, 0x52, 0x01, 0xff, 0xff]);
  const good = Buffer.from(Usb.buildFrame(Usb.CH_CTRL, bytesFromPayload('{"t":"hello"}')));
  const frames = parseAll(Buffer.concat([bad, good]));
  assert.strictEqual(frames.length, 1);
});
