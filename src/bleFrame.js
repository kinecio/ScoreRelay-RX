/**
 * ScoreRelay Bluetooth LE message framing (Node side).
 *
 * A request or reply that fits in one ATT payload is a bare JSON object (it
 * starts with '{'). Anything larger is split into chunks:
 *
 *   0xFF <msgid:u8> <total:u16 BE> <seq:u16 BE> <fragment…>
 *
 * `seq` starts at 0 and a seq-0 frame always restarts reassembly, so a sender
 * can abandon an attempt and resend from the top. The older, shorter header
 * (`<total:u16 BE> <seq:u8> <fragment…>`) is still accepted on the way in.
 *
 * Pure functions, no I/O — driven by `bleLink.js` and unit-tested directly.
 */

'use strict';

const CHUNK_MARKER = 0xff;
const CHUNK_HEADER = 6;
/** Largest message the device will assemble. */
const MAX_MESSAGE = 8192;
/**
 * Never write more than this per ATT write, whatever the link negotiated: the
 * device's radio path is only reliable up to roughly this size.
 */
const MAX_WRITE_PAYLOAD = 244;
/** ATT's guaranteed minimum payload (default MTU 23 minus 3). */
const MIN_WRITE_PAYLOAD = 20;

/**
 * Split one JSON request into the ATT writes that carry it.
 * @param {Buffer} payload UTF-8 JSON bytes.
 * @param {number} writePayload Largest single ATT write the link accepts.
 * @param {number} msgid 1..255, unique per request in flight.
 * @returns {Buffer[]}
 */
function encodeRequest(payload, writePayload, msgid) {
  const bytes = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  if (bytes.length > MAX_MESSAGE) throw new Error('request too large for the device');
  const size = Math.max(MIN_WRITE_PAYLOAD, Math.min(writePayload | 0, MAX_WRITE_PAYLOAD));
  if (bytes.length <= size) return [bytes];

  const room = size - CHUNK_HEADER;
  const frames = [];
  for (let off = 0, seq = 0; off < bytes.length; off += room, seq++) {
    const n = Math.min(room, bytes.length - off);
    const frame = Buffer.alloc(CHUNK_HEADER + n);
    frame[0] = CHUNK_MARKER;
    frame[1] = msgid & 0xff;
    frame.writeUInt16BE(bytes.length, 2);
    frame.writeUInt16BE(seq, 4);
    bytes.copy(frame, CHUNK_HEADER, off, off + n);
    frames.push(frame);
  }
  return frames;
}

/**
 * Turns the device's notifications back into whole JSON messages.
 *
 * `feed()` returns the complete messages that notification finished (as UTF-8
 * strings). A gap in `seq` means a fragment was lost, which makes the whole
 * reply unusable; that is reported through `onGap` so the caller can fail its
 * waiting request straight away instead of sitting on a timeout.
 */
class ReplyAssembler {
  constructor(onGap) {
    this.onGap = onGap || (() => {});
    this.reset();
  }

  reset() {
    this.parts = [];
    this.length = 0;
    this.total = 0;
    this.nextSeq = 0;
  }

  feed(chunk) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk || []);
    if (!bytes.length) return [];

    // A bare JSON object is a complete, unchunked message.
    if (bytes[0] === 0x7b) return [bytes.toString('utf8')];

    let total;
    let seq;
    let start;
    if (bytes[0] === CHUNK_MARKER) {
      if (bytes.length < CHUNK_HEADER) return [];
      total = bytes.readUInt16BE(2);
      seq = bytes.readUInt16BE(4);
      start = CHUNK_HEADER;
    } else {
      if (bytes.length < 3) return [];
      total = bytes.readUInt16BE(0);
      seq = bytes[2];
      start = 3;
    }

    if (seq === 0) {
      this.reset();
      this.total = total;
    }
    if (!this.total) return []; // continuation with no start frame
    if (seq !== this.nextSeq) {
      this.reset();
      this.onGap(new Error('the device reply was truncated (a fragment was lost)'));
      return [];
    }

    const fragment = bytes.subarray(start);
    this.parts.push(fragment);
    this.length += fragment.length;
    this.nextSeq++;

    if (this.length < this.total) return [];
    const whole = Buffer.concat(this.parts, this.length).toString('utf8');
    this.reset();
    return [whole];
  }
}

module.exports = {
  CHUNK_MARKER,
  CHUNK_HEADER,
  MAX_MESSAGE,
  MAX_WRITE_PAYLOAD,
  MIN_WRITE_PAYLOAD,
  encodeRequest,
  ReplyAssembler,
};
