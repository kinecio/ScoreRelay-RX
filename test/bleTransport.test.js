'use strict';

// The Bluetooth helper is a separate process so that a fatal failure inside
// it (macOS aborts a process that touches Bluetooth without permission) can
// never take the server down. This runs a real child that dies that way.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { fork } = require('node:child_process');
const { HelperTransport, exitError } = require('../src/bleTransport');

function crashingTransport(script) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'srx-ble-')), 'child.js');
  fs.writeFileSync(file, script);
  const t = new HelperTransport();
  t._spawn = function spawnCrasher() {
    this.child = fork(file, [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    this.child.on('message', (m) => this._onMessage(m));
    this.child.on('exit', (code, signal) => this._die(exitError(code, signal)));
  };
  return t;
}

test('a helper that aborts fails the request and reports; the parent keeps running', async () => {
  const t = crashingTransport("process.on('message', () => process.abort());");
  const dead = new Promise((resolve) => t.on('dead', resolve));
  await assert.rejects(() => t.start(), (e) => {
    if (process.platform === 'darwin') {
      assert.strictEqual(e.code, 'permission_denied');
      assert.match(e.message, /Privacy & Security/);
    } else {
      assert.strictEqual(e.code, 'bluetooth_unavailable');
    }
    return true;
  });
  const err = await dead;
  assert.ok(err.code);
  // Later requests fail fast instead of hanging.
  await assert.rejects(() => t.scan(1000), (e) => e.code === 'bluetooth_unavailable');
});

test('requests to a helper that answers are matched by id', async () => {
  const t = crashingTransport(`
    process.on('message', (m) => {
      if (m.op === 'start') process.send({ reqId: m.reqId, ok: true, result: {} });
      if (m.op === 'connect') process.send({ reqId: m.reqId, ok: true, result: { writePayload: 100 } });
      if (m.op === 'write') { process.send({ reqId: m.reqId, ok: true, result: {} }); process.send({ ev: 'data', b64: Buffer.from('hi').toString('base64') }); }
    });
  `);
  const got = new Promise((resolve) => t.once('data', resolve));
  await t.start();
  assert.deepStrictEqual(await t.connect('x'), { writePayload: 100 });
  await t.write(Buffer.from('ping'));
  assert.strictEqual((await got).toString(), 'hi');
  t.kill();
});
