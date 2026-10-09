'use strict';

// Tests for automatic web-port selection (src/portFinder.js). Real sockets on
// loopback with throwaway ports; no device or network is involved.

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const net = require('node:net');

const { findAvailablePort, portIsTaken } = require('../src/portFinder');

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function hold(port, host) {
  return new Promise((resolve, reject) => {
    const s = net.createServer((c) => c.destroy());
    s.once('error', reject);
    s.listen(port, host, () => resolve(s));
  });
}

const close = (s) => new Promise((resolve) => s.close(() => resolve()));

async function ipv6Works() {
  try {
    const s = await hold(0, '::1');
    await close(s);
    return true;
  } catch (_) {
    return false;
  }
}

test('uses the first port when nothing else is on it', async () => {
  const [a, b] = [await freePort(), await freePort()];
  const server = http.createServer();
  try {
    assert.strictEqual(await findAvailablePort(server, [a, b]), a);
    assert.ok(server.listening);
  } finally {
    await close(server);
  }
});

test('skips a port another program holds on 127.0.0.1', async () => {
  const [a, b] = [await freePort(), await freePort()];
  const other = await hold(a, '127.0.0.1');
  const server = http.createServer();
  try {
    assert.strictEqual(await findAvailablePort(server, [a, b]), b);
  } finally {
    await close(server);
    await close(other);
  }
});

test('skips a port another program holds on every interface', async () => {
  const [a, b] = [await freePort(), await freePort()];
  const other = await hold(a, '0.0.0.0');
  const server = http.createServer();
  try {
    assert.strictEqual(await findAvailablePort(server, [a, b]), b);
  } finally {
    await close(server);
    await close(other);
  }
});

test('skips a port another program holds only on the IPv6 loopback (the Windows "localhost" case)', async (t) => {
  if (!(await ipv6Works())) return t.skip('IPv6 loopback is not available');
  const [a, b] = [await freePort(), await freePort()];
  const other = await hold(a, '::1');
  const server = http.createServer();
  try {
    // Binding 0.0.0.0:a succeeds here (different address family), which is
    // exactly why a successful listen() is not enough on its own.
    assert.strictEqual(await portIsTaken(a), true);
    assert.strictEqual(await findAvailablePort(server, [a, b]), b);
  } finally {
    await close(server);
    await close(other);
  }
});

test('returns null when every candidate is taken', async () => {
  const [a, b] = [await freePort(), await freePort()];
  const holders = [await hold(a, '127.0.0.1'), await hold(b, '127.0.0.1')];
  const server = http.createServer();
  try {
    assert.strictEqual(await findAvailablePort(server, [a, b]), null);
    assert.strictEqual(server.listening, false);
  } finally {
    for (const h of holders) await close(h);
  }
});

test('a port with nothing on it is reported free', async () => {
  const p = await freePort();
  assert.strictEqual(await portIsTaken(p), false);
});
