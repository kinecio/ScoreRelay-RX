'use strict';

// Tests for the USB cloud tunnel's byte relay (src/usbTunnel.js). The TCP
// socket is faked, so no cloud and no credentials are involved.

const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');

const tunnel = require('../src/usbTunnel');

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

function withFakeSockets(fn) {
  const sockets = [];
  tunnel.setConnector((host, port) => {
    const socket = new FakeSocket();
    socket.host = host;
    socket.port = port;
    sockets.push(socket);
    return socket;
  });
  try {
    fn(sockets);
  } finally {
    tunnel.stop();
    tunnel.reset();
    tunnel.setConnector(null);
  }
}

test('does not dial until the first payload, then buffers until connected', () => {
  withFakeSockets((sockets) => {
    tunnel.configure({ host: 'cloud.invalid', port: 4443 });
    assert.strictEqual(sockets.length, 0, 'no socket before any payload');
    assert.strictEqual(tunnel.status().configured, true);
    assert.strictEqual(tunnel.status().connected, false);

    tunnel.sendToCloud(Buffer.from('client-hello'));
    assert.strictEqual(sockets.length, 1, 'dialed on first payload');
    assert.strictEqual(sockets[0].host, 'cloud.invalid');
    assert.strictEqual(sockets[0].port, 4443);
    assert.deepStrictEqual(sockets[0].writes, [], 'still buffered while connecting');

    sockets[0].emit('connect');
    assert.deepStrictEqual(sockets[0].writes.map(String), ['client-hello'], 'flushed on connect');
    assert.strictEqual(tunnel.isConnected(), true);
  });
});

test('relays cloud bytes back to the device callback', () => {
  withFakeSockets((sockets) => {
    const received = [];
    tunnel.setOnData((data) => received.push(Buffer.from(data)));
    tunnel.configure({ host: 'cloud.invalid', port: 4443 });
    tunnel.sendToCloud(Buffer.from('x'));
    sockets[0].emit('connect');
    sockets[0].emit('data', Buffer.from('server-hello'));
    assert.deepStrictEqual(received.map(String), ['server-hello']);
    tunnel.setOnData(null);
  });
});

test('reconnects on the next payload after a dropped socket', () => {
  withFakeSockets((sockets) => {
    tunnel.configure({ host: 'cloud.invalid', port: 4443 });
    tunnel.sendToCloud(Buffer.from('one'));
    sockets[0].emit('connect');
    sockets[0].destroy();
    assert.strictEqual(tunnel.isConnected(), false);

    tunnel.sendToCloud(Buffer.from('two'));
    assert.strictEqual(sockets.length, 2, 'a fresh socket was opened');
    sockets[1].emit('connect');
    assert.deepStrictEqual(sockets[1].writes.map(String), ['two']);
  });
});

test('stop() tears the socket down and clears the queue', () => {
  withFakeSockets((sockets) => {
    tunnel.configure({ host: 'cloud.invalid', port: 4443 });
    tunnel.sendToCloud(Buffer.from('one'));
    assert.strictEqual(sockets.length, 1);
    tunnel.stop();
    assert.strictEqual(sockets[0].destroyed, true);
    assert.strictEqual(tunnel.isConnected(), false);
  });
});
