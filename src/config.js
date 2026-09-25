/**
 * Application configuration. Edit these values for your deployment.
 * No secrets should be committed; use credentials.json for the cloud access
 * token / local device token.
 *
 * Guardrails for this repo (it is open source):
 *  - Never commit credentials, API tokens, or any secret.
 *  - The cloud endpoint below is the fixed connection endpoint and is
 *    intentionally NOT configurable from the web UI — users cannot
 *    accidentally point the app somewhere else. It is a public hostname,
 *    not a secret; nothing else about the service's internals belongs here.
 */

const path = require('path');
const os = require('os');

// Default data folder in user's Documents (user can override from web UI)
const defaultDataDir = path.join(os.homedir(), 'Documents', 'ScoreRelay-RX-Data');

module.exports = {
  defaultDataDir,
  // ScoreRelay Cloud — the fixed Live Data Gateway endpoint the app streams
  // from in "Cloud" mode, authenticated with a single access token the user
  // copies from the ScoreRelay cloud portal (never a device password). Deliberately not exposed in the web UI (see
  // guardrails above).
  liveGateway: {
    protocol: 'https',
    host: 'live.pub.kinec.io',
    statePath: '/v1/state',
  },

  // "Local device" mode: connects straight to a ScoreRelay device's TLS TCP
  // feed on the LAN (port 1010 by default) using the device's API token.
  localDevice: {
    port: 1010,
  },

  // Ports to try for web server (first available wins)
  webPorts: [8080, 8085, 8090, 8095, 8100, 8105, 8110, 8115, 8120, 8125],

  // GitHub repo for update check (owner/repo)
  githubRepo: 'kinecio/ScoreRelay-RX',

  // Hosted TCP server port (for broadcasting JSON to clients)
  hostedTcpPort: 9001,
};
