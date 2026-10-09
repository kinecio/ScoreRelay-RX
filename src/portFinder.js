const net = require('net');
const config = require('./config');

// Loopback addresses that "localhost" can resolve to. On Windows a program can
// listen on [::1]:8080 (what a browser reaches for "localhost") while this app
// still succeeds in binding 0.0.0.0:8080, so a successful listen() alone does
// not prove the port is ours. Every candidate is therefore probed on both
// loopback addresses first.
const LOOPBACK_HOSTS = ['127.0.0.1', '::1'];
const PROBE_TIMEOUT_MS = 750;

// Errors that mean "nothing is listening there" (including IPv6 being absent).
const NOT_LISTENING = new Set([
  'ECONNREFUSED', 'EADDRNOTAVAIL', 'EAFNOSUPPORT', 'ENETUNREACH', 'EHOSTUNREACH', 'ECONNRESET',
]);

// Ports that cannot be bound for a reason that another port may not share
// (taken, or reserved by the OS - Windows reserves ranges for Hyper-V/WSL).
const SKIPPABLE_BIND_ERRORS = new Set(['EADDRINUSE', 'EACCES', 'EADDRNOTAVAIL']);

/**
 * Resolves true when something accepts connections on host:port.
 * A probe that times out counts as "in use" so the app never shares a port.
 */
function somethingListening(port, host, timeoutMs = PROBE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(true));
    socket.once('error', (err) => done(!NOT_LISTENING.has(err && err.code)));
  });
}

async function portIsTaken(port, hosts = LOOPBACK_HOSTS) {
  const results = await Promise.all(hosts.map((host) => somethingListening(port, host)));
  return results.some(Boolean);
}

// Resolves null when listening started, otherwise the error that stopped it.
function listenOn(server, port) {
  return new Promise((resolve) => {
    const onError = (err) => {
      server.removeListener('listening', onListening);
      resolve(err || new Error('listen failed'));
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve(null);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '0.0.0.0');
  });
}

/**
 * Bind the server to the first usable port (8080, 8085, 8090, ...).
 * A port is skipped when another program already answers on it (on either
 * loopback address) or when the operating system refuses the bind.
 * @param {import('http').Server} server - Node HTTP/Express server instance
 * @param {number[]} [ports] - candidates in order of preference
 * @returns {Promise<number|null>} - the port, or null if none could be used
 */
async function findAvailablePort(server, ports = config.webPorts || [8080, 8085, 8090, 8095, 8100]) {
  for (const port of ports) {
    if (await portIsTaken(port)) continue;
    const err = await listenOn(server, port);
    if (!err) return port;
    if (!SKIPPABLE_BIND_ERRORS.has(err.code)) return null;
  }
  return null;
}

module.exports = { findAvailablePort, portIsTaken };
