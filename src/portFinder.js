const http = require('http');
const config = require('./config');

/**
 * Try binding to ports in order (8080, 8085, 8090, ...) until one succeeds.
 * Returns the first available port or null if none available.
 * @param {http.Server} server - Node HTTP/Express server instance
 * @returns {Promise<number|null>} - Port number or null
 */
function findAvailablePort(server) {
  const ports = config.webPorts || [8080, 8085, 8090, 8095, 8100];
  let index = 0;

  return new Promise((resolve) => {
    function tryNext() {
      if (index >= ports.length) {
        resolve(null);
        return;
      }
      const port = ports[index];
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          index++;
          tryNext();
        } else {
          resolve(null);
        }
      });
      server.listen(port, '0.0.0.0', () => {
        resolve(port);
      });
    }
    tryNext();
  });
}

module.exports = { findAvailablePort };
