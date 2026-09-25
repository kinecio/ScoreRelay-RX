'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { encodeRequest, ReplyAssembler, CHUNK_MARKER, MAX_WRITE_PAYLOAD } = require('../src/bleFrame');

function json(n) {
  return Buffer.from(JSON.stringify({ id: 1, method: 'x', params: { pad: 'a'.repeat(n) } }));
}

test('a request that fits is sent as one bare JSON write', () => {
  const body = json(10);
  const frames = encodeRequest(body, 100, 1);
  assert.strictEqual(frames.length, 1);
  assert.deepStrictEqual(frames[0], body);
  assert.strictEqual(frames[0][0], 0x7b);
});

test('a large request is chunked so every whole frame fits one ATT write', () => {
  for (const writePayload of [20, 100, 182, 244]) {
    const body = json(3000);
    const frames = encodeRequest(body, writePayload, 7);
    assert.ok(frames.length > 1);
    frames.forEach((f, i) => {
      assert.ok(f.length <= writePayload, `frame ${i} is ${f.length} > ${writePayload}`);
      assert.strictEqual(f[0], CHUNK_MARKER);
      assert.strictEqual(f[1], 7);
      assert.strictEqual(f.readUInt16BE(2), body.length);
      assert.strictEqual(f.readUInt16BE(4), i);
    });
    const joined = Buffer.concat(frames.map((f) => f.subarray(6)));
    assert.deepStrictEqual(joined, body);
  }
});

test('the write size is clamped to the safe ceiling and floor', () => {
  const big = encodeRequest(json(3000), 517, 1);
  assert.ok(big.every((f) => f.length <= MAX_WRITE_PAYLOAD));
  const tiny = encodeRequest(json(200), 5, 1);
  assert.ok(tiny.every((f) => f.length <= 20));
});

test('requests beyond what the device will assemble are refused up front', () => {
  assert.throws(() => encodeRequest(Buffer.alloc(9000, 0x61), 244, 1), /too large/);
});

test('the sequence number is 16 bits, so long requests do not wrap', () => {
  // 8 KB at the 20-byte floor is ~590 frames, past the 8-bit limit of the old header.
  const frames = encodeRequest(json(8000), 20, 1);
  assert.ok(frames.length > 256);
  assert.strictEqual(frames[frames.length - 1].readUInt16BE(4), frames.length - 1);
});

function v2(msgid, total, seq, data) {
  const h = Buffer.alloc(6);
  h[0] = 0xff; h[1] = msgid; h.writeUInt16BE(total, 2); h.writeUInt16BE(seq, 4);
  return Buffer.concat([h, data]);
}

test('ReplyAssembler passes bare JSON straight through', () => {
  const a = new ReplyAssembler();
  assert.deepStrictEqual(a.feed(Buffer.from('{"id":1,"ok":true}')), ['{"id":1,"ok":true}']);
});

test('ReplyAssembler reassembles a chunked reply, including multi-byte text', () => {
  const text = JSON.stringify({ id: 2, ok: true, result: { name: 'Zoë – Ünïcode ✓', pad: 'z'.repeat(500) } });
  const bytes = Buffer.from(text, 'utf8');
  const a = new ReplyAssembler();
  const out = [];
  // Split mid-way through a multi-byte character on purpose.
  for (let off = 0, seq = 0; off < bytes.length; off += 97, seq++) {
    out.push(...a.feed(v2(3, bytes.length, seq, bytes.subarray(off, off + 97))));
  }
  assert.deepStrictEqual(out, [text]);
});

test('ReplyAssembler still accepts the older, shorter chunk header', () => {
  const bytes = Buffer.from(JSON.stringify({ id: 4, ok: true, result: { pad: 'q'.repeat(300) } }));
  const a = new ReplyAssembler();
  const out = [];
  for (let off = 0, seq = 0; off < bytes.length; off += 120, seq++) {
    const h = Buffer.alloc(3);
    h.writeUInt16BE(bytes.length, 0);
    h[2] = seq;
    out.push(...a.feed(Buffer.concat([h, bytes.subarray(off, off + 120)])));
  }
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0], bytes.toString());
});

test('a lost fragment is reported immediately rather than left to time out', () => {
  const gaps = [];
  const a = new ReplyAssembler((e) => gaps.push(e.message));
  const bytes = Buffer.from(JSON.stringify({ id: 5, ok: true, result: { pad: 'w'.repeat(400) } }));
  a.feed(v2(1, bytes.length, 0, bytes.subarray(0, 100)));
  const out = a.feed(v2(1, bytes.length, 2, bytes.subarray(200, 300))); // seq 1 never arrived
  assert.deepStrictEqual(out, []);
  assert.strictEqual(gaps.length, 1);
  assert.match(gaps[0], /truncated/);
});

test('a seq-0 frame restarts reassembly, so a sender can start over', () => {
  const a = new ReplyAssembler();
  const bytes = Buffer.from(JSON.stringify({ id: 6, ok: true, result: { pad: 'k'.repeat(250) } }));
  a.feed(v2(1, bytes.length, 0, bytes.subarray(0, 100)));
  const out = [
    ...a.feed(v2(2, bytes.length, 0, bytes.subarray(0, 100))),
    ...a.feed(v2(2, bytes.length, 1, bytes.subarray(100, 200))),
    ...a.feed(v2(2, bytes.length, 2, bytes.subarray(200))),
  ];
  assert.deepStrictEqual(out, [bytes.toString()]);
});

test('a continuation frame with no start frame is ignored', () => {
  const a = new ReplyAssembler();
  assert.deepStrictEqual(a.feed(v2(1, 100, 3, Buffer.from('xyz'))), []);
});
