const net = require('net');

let server = null;
const clients = new Set();

function start(port) {
  if (server) return;
  server = net.createServer((socket) => {
    clients.add(socket);
    socket.on('close', () => clients.delete(socket));
    socket.on('error', () => clients.delete(socket));
  });
  server.listen(port, '0.0.0.0', () => {
    console.log('Hosted TCP server listening on port', port);
  });
  server.on('error', (err) => {
    console.error('Hosted TCP server error:', err.message);
  });
}

function stop() {
  if (server) {
    server.close();
    clients.forEach((s) => { try { s.destroy(); } catch (_) {} });
    clients.clear();
    server = null;
  }
}

function broadcast(data) {
  const payload = JSON.stringify(data) + '\n';
  clients.forEach((socket) => {
    try {
      if (socket.writable) socket.write(payload);
    } catch (_) {}
  });
}

module.exports = { start, stop, broadcast };
