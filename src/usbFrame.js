/**
 * ScoreRelay USB link framing (Node side).
 *
 * The device's USB port is a framed channel, not a text console:
 *
 *   0x00 'S' 'R' <channel:u8> <len:u16 LE> <payload:len> <crc:u16 LE>
 *
 * CRC-16/CCITT is over the payload only. The 0x00 "SR" lead-in lets the
 * reader resynchronise after a truncated frame (device unplugged mid-message,
 * process restarted, …). Mirrors the device's own framer so host and device
 * agree on frame boundaries.
 *
 * Channels the app uses: STATE (live envelope), CTRL (hello/ping), PIPE (the
 * device's already-encrypted cloud bytes, relayed by usbTunnel.js).
 */

'use strict';

const LEAD = 0x00;
const MAGIC_S = 0x53;
const MAGIC_R = 0x52;
const MAX_PAYLOAD = 2048;

const CH_STATE = 0x01;
const CH_PIPE = 0x02;
const CH_CTRL = 0x03;

function crc16(bytes) {
  let crc = 0xffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i] << 8;
    for (let k = 0; k < 8; k++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc & 0xffff;
}

function buildFrame(channel, payload) {
  const bytes = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || []);
  if (bytes.length > MAX_PAYLOAD) throw new Error('payload too large');
  const frame = Buffer.alloc(6 + bytes.length + 2);
  frame[0] = LEAD;
  frame[1] = MAGIC_S;
  frame[2] = MAGIC_R;
  frame[3] = channel & 0xff;
  frame[4] = bytes.length & 0xff;
  frame[5] = (bytes.length >> 8) & 0xff;
  bytes.copy(frame, 6);
  const crc = crc16(bytes);
  frame[6 + bytes.length] = crc & 0xff;
  frame[7 + bytes.length] = (crc >> 8) & 0xff;
  return frame;
}

function buildCtrlFrame(obj) {
  return buildFrame(CH_CTRL, Buffer.from(JSON.stringify(obj), 'utf8'));
}

class UsbFrameParser {
  constructor() {
    this.buf = [];
  }

  reset() {
    this.buf = [];
  }

  /**
   * Feed raw bytes from the serial read.
   * @param {Buffer|Uint8Array} chunk
   * @returns {{channel: number, payload: Buffer}[]}
   */
  feed(chunk) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk || []);
    for (let i = 0; i < bytes.length; i++) this.buf.push(bytes[i]);

    const out = [];
    for (;;) {
      // Find the 3-byte lead-in.
      let start = -1;
      for (let i = 0; i + 2 < this.buf.length; i++) {
        if (this.buf[i] === LEAD && this.buf[i + 1] === MAGIC_S && this.buf[i + 2] === MAGIC_R) {
          start = i;
          break;
        }
      }
      if (start < 0) {
        // Keep a trailing partial lead-in so it can complete on the next read.
        const n = this.buf.length;
        let keep = 0;
        if (n >= 2 && this.buf[n - 2] === LEAD && this.buf[n - 1] === MAGIC_S) keep = 2;
        else if (n >= 1 && this.buf[n - 1] === LEAD) keep = 1;
        this.buf = this.buf.slice(n - keep);
        break;
      }
      if (start > 0) this.buf = this.buf.slice(start);
      if (this.buf.length < 6) break;

      const channel = this.buf[3];
      const len = this.buf[4] | (this.buf[5] << 8);
      if (len > MAX_PAYLOAD) {
        this.buf.shift(); // false lead-in; rescan one byte in
        continue;
      }
      const total = 6 + len + 2;
      if (this.buf.length < total) break;

      const payload = Buffer.from(this.buf.slice(6, 6 + len));
      const crc = this.buf[6 + len] | (this.buf[7 + len] << 8);
      if (crc16(payload) === crc) {
        out.push({ channel, payload });
        this.buf = this.buf.slice(total);
      } else {
        this.buf.shift(); // bad checksum; rescan
      }
    }
    return out;
  }
}

module.exports = {
  LEAD,
  MAX_PAYLOAD,
  CH_STATE,
  CH_PIPE,
  CH_CTRL,
  crc16,
  buildFrame,
  buildCtrlFrame,
  UsbFrameParser,
};
