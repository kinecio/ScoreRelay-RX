const liveGatewayClient = require('./liveGatewayClient');
const tcpClient = require('./tcpClient');
const usbLink = require('./usbLink');
const bleLink = require('./bleLink');
const dataAggregator = require('./dataAggregator');
const config = require('./config');

let mode = null; // 'cloud' | 'local' | 'tcp' | 'usb' | 'ble'
let messageCount = 0;
let lastActivity = null;
let lastError = null;

function getStats() {
  if (mode === 'usb') {
    const usb = usbLink.getStats();
    return {
      mode,
      connected: usb.connected,
      messageCount: usb.messageCount,
      lastActivity: usb.lastActivity,
      lastError: usb.lastError,
      usbPort: usb.portLabel || null,
      usbFirmware: usb.firmware || null,
      usbTunnel: usb.tunnel || null,
      data: dataAggregator.getData(),
      rawDataMode: dataAggregator.getRawDataMode(),
    };
  }
  if (mode === 'ble') {
    const ble = bleLink.getStats();
    return {
      mode,
      connected: ble.connected,
      messageCount: ble.messageCount,
      lastActivity: ble.lastActivity,
      lastError: ble.lastError,
      blePhase: ble.phase,
      bleDeviceName: ble.deviceName || null,
      bleErrorCode: ble.lastErrorCode,
      bleMustChangePassword: ble.mustChangePassword,
      bleDevice: ble.device,
      bleRelay: ble.relay,
      data: dataAggregator.getData(),
      rawDataMode: dataAggregator.getRawDataMode(),
    };
  }
  const cloudConnected = liveGatewayClient.isConnected();
  const tcpConnected = tcpClient.isConnected();
  const connected = mode === 'cloud' ? cloudConnected : (mode === 'local' || mode === 'tcp') ? tcpConnected : false;
  return {
    mode,
    connected,
    messageCount,
    lastActivity: lastActivity ? lastActivity.toISOString() : null,
    lastError: lastError ? lastError.message || String(lastError) : null,
    data: dataAggregator.getData(),
    rawDataMode: dataAggregator.getRawDataMode(),
  };
}

function onMessage() {
  messageCount++;
  lastActivity = new Date();
}

function connect(options) {
  const { mode: m, token, tcpHost, tcpPort, apiToken, outputs } = options || {};
  mode = m || 'cloud';
  lastError = null;

  dataAggregator.setOutputFlags({
    json: !!outputs?.json,
    txt: !!outputs?.txt,
    tcp: !!outputs?.tcp,
    graphic: !!outputs?.graphic,
  });

  if (mode === 'usb') {
    // USB device mode: the server owns the serial port (src/usbLink.js), so
    // the connection survives the browser window closing. See usbLink.open().
    const path = options.usbPath;
    if (!path) {
      return Promise.resolve({ success: false, error: 'USB port required' });
    }
    return usbLink.open(path).then((ok) => {
      if (ok) return { success: true };
      const stats = usbLink.getStats();
      return { success: false, error: stats.lastError || 'Failed to open USB port' };
    });
  }

  if (mode === 'ble') {
    // Bluetooth device mode: the server owns the Bluetooth session
    // (src/bleLink.js), so like USB it survives the browser window closing.
    const { bleId, bleName, blePassword } = options;
    if (!bleId) return Promise.resolve({ success: false, error: 'Pick a Bluetooth device first' });
    if (!blePassword) return Promise.resolve({ success: false, error: 'Device admin password required' });
    return bleLink.open({ id: bleId, name: bleName, adminPassword: blePassword });
  }

  if (mode === 'cloud') {
    // Cloud mode: fixed Live Data Gateway endpoint from config, authenticated
    // with a single access token from the ScoreRelay cloud portal — never a
    // device password.
    if (!token) {
      return Promise.resolve({ success: false, error: 'Access token required' });
    }
    return liveGatewayClient.connect({ token }, {
      onConnect: onMessage,
      onMessage: onMessage,
      onError: (err) => { lastError = err; },
    });
  }

  if (mode === 'local') {
    // Local device mode: TLS TCP feed on the LAN with the device's API token.
    const host = tcpHost || '';
    const port = parseInt(tcpPort || config.localDevice.port, 10) || config.localDevice.port;
    if (!host) return Promise.resolve({ success: false, error: 'Device address required' });
    if (!apiToken) return Promise.resolve({ success: false, error: 'API token required' });
    return tcpClient.connectTls({ host, port, token: apiToken }, {
      onMessage,
      onError: (err) => { lastError = err; },
    });
  }

  if (mode === 'tcp') {
    // Legacy plaintext TCP (dev mode) — kept for testing.
    const host = tcpHost || config.tcpServer.host;
    const port = parseInt(tcpPort || config.tcpServer.port, 10) || config.tcpServer.port;
    return tcpClient.connect({ host, port }, {
      onMessage,
      onError: (err) => { lastError = err; },
    });
  }

  return Promise.resolve({ success: false, error: 'Unknown mode' });
}

function disconnect() {
  liveGatewayClient.disconnect();
  tcpClient.disconnect();
  usbLink.close();
  bleLink.close();
  dataAggregator.stopTcpServer();
  mode = null;
  messageCount = 0;
  lastActivity = null;
}

function isConnected() {
  if (mode === 'cloud') return liveGatewayClient.isConnected();
  if (mode === 'usb') return usbLink.isConnected();
  if (mode === 'ble') return bleLink.isConnected();
  if (mode === 'local' || mode === 'tcp') return tcpClient.isConnected();
  return false;
}

module.exports = {
  getStats,
  connect,
  disconnect,
  isConnected,
};
