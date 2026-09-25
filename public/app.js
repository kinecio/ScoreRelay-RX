(function () {
  const API = '/api';

  const $ = (id) => document.getElementById(id);
  const modeRadios = document.querySelectorAll('input[name="mode"]');
  const cloudFields = $('cloud-fields');
  const localFields = $('local-fields');
  const cloudToken = $('cloud-token');
  const saveCredentials = $('save-credentials');
  const localHost = $('local-host');
  const localPort = $('local-port');
  const localToken = $('local-token');
  const usbFields = $('usb-fields');
  const usbPortName = $('usb-port-name');
  const usbPortSelect = $('usb-port-select');
  const btnRefreshUsb = $('btn-refresh-usb');
  const bleFields = $('ble-fields');
  const bleDeviceSelect = $('ble-device-select');
  const btnScanBle = $('btn-scan-ble');
  const bleScanStatus = $('ble-scan-status');
  const blePassword = $('ble-password');
  const bleStatus = $('ble-status');
  const bleManage = $('ble-manage');
  const outputJson = $('output-json');
  const outputTxt = $('output-txt');
  const outputTcp = $('output-tcp');
  const outputGraphic = $('output-graphic');
  const btnConnect = $('btn-connect');
  const btnDisconnect = $('btn-disconnect');
  const connectionStatus = $('connection-status');
  const statsLine = $('stats-line');
  const errorLine = $('error-line');
  const dataPreview = $('data-preview');
  const btnRawData = $('btn-raw-data');
  const updateBanner = $('update-banner');
  const updateLink = $('update-link');
  const dismissUpdate = $('dismiss-update');
  const checkUpdates = $('check-updates');
  const versionEl = $('version');
  const dataPathInput = $('data-path');
  const btnSavePath = $('btn-save-path');

  function getMode() {
    return document.querySelector('input[name="mode"]:checked')?.value || 'cloud';
  }

  function toggleModeFields() {
    const mode = getMode();
    cloudFields.classList.toggle('hidden', mode !== 'cloud');
    localFields.classList.toggle('hidden', mode !== 'local');
    usbFields.classList.toggle('hidden', mode !== 'usb');
    bleFields.classList.toggle('hidden', mode !== 'ble');
    if (mode === 'usb' && usbPortSelect && !usbPortSelect.options.length) loadUsbPorts();
  }

  modeRadios.forEach((r) => r.addEventListener('change', toggleModeFields));
  toggleModeFields();

  function loadCredentials() {
    fetch(API + '/credentials')
      .then((res) => res.json())
      .then((data) => {
        if (data.token) cloudToken.value = data.token;
      })
      .catch(() => {});
  }

  function refreshStats() {
    fetch(API + '/stats')
      .then((res) => res.json())
      .then((data) => {
        const connected = data.connected === true;
        connectionStatus.textContent = connected ? 'Connected (' + (data.mode || '') + ')' : 'Disconnected';
        connectionStatus.className = 'status ' + (connected ? 'connected' : 'disconnected');
        statsLine.textContent = 'Messages: ' + (data.messageCount || 0) + '. Last activity: ' + (data.lastActivity || '—');
        if (data.mode === 'usb' && data.usbPort) {
          usbPortName.textContent = 'Connected to ' + data.usbPort + '.' +
            (data.usbTunnel && data.usbTunnel.connected ? ' Cloud link active.' : '');
        } else if (data.mode !== 'usb') {
          usbPortName.textContent = '';
        }
        renderBle(data);
        if (data.lastError) {
          errorLine.textContent = data.lastError;
          errorLine.classList.remove('hidden');
        } else {
          errorLine.classList.add('hidden');
        }
        dataPreview.textContent = JSON.stringify(data.data || {}, null, 2);
        btnRawData.classList.toggle('active', data.rawDataMode === true);
        btnRawData.setAttribute('aria-pressed', data.rawDataMode === true ? 'true' : 'false');
        btnConnect.disabled = connected;
        btnDisconnect.disabled = !connected;
      })
      .catch(() => {
        connectionStatus.textContent = 'Disconnected';
        connectionStatus.className = 'status disconnected';
        btnConnect.disabled = false;
        btnDisconnect.disabled = true;
      });
  }

  function loadDataPath() {
    fetch(API + '/data-path')
      .then((res) => res.json())
      .then((data) => {
        if (data.dataPath) dataPathInput.value = data.dataPath;
      })
      .catch(() => {});
  }

  function saveDataPath() {
    const pathValue = dataPathInput.value.trim();
    if (!pathValue) {
      alert('Enter a folder path');
      return;
    }
    fetch(API + '/data-path', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataPath: pathValue }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.ok) {
          if (typeof btnSavePath.dataset.saved !== 'undefined') return;
          const label = btnSavePath.textContent;
          btnSavePath.textContent = 'Saved';
          btnSavePath.dataset.saved = '1';
          setTimeout(() => {
            btnSavePath.textContent = label;
            delete btnSavePath.dataset.saved;
          }, 1500);
        } else {
          alert(data.error || 'Failed to save path');
        }
      })
      .catch((err) => alert(err.message || 'Failed to save path'));
  }

  loadCredentials();
  loadDataPath();
  refreshStats();
  const statsInterval = setInterval(refreshStats, 2000);

  btnSavePath.addEventListener('click', saveDataPath);

  btnRawData.addEventListener('click', () => {
    const nextRaw = !btnRawData.classList.contains('active');
    fetch(API + '/raw-data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawData: nextRaw }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.ok) refreshStats();
        else alert(data.error || 'Failed to set raw data mode');
      })
      .catch((err) => alert(err.message || 'Failed to set raw data mode'));
  });

  // -- USB device mode --------------------------------------------------
  // The server owns the serial port (src/usbLink.js), so the connection
  // stays up without this page. The page only lists ports and asks the
  // server to open or close one.

  function loadUsbPorts() {
    if (!usbPortSelect) return Promise.resolve();
    let previous = usbPortSelect.value;
    if (!previous && window.localStorage) previous = localStorage.getItem('usbPort') || '';
    usbPortSelect.innerHTML = '';
    const loading = document.createElement('option');
    loading.value = '';
    loading.textContent = 'Loading…';
    usbPortSelect.appendChild(loading);
    return fetch(API + '/usb/ports')
      .then((res) => res.json())
      .then((data) => {
        const ports = (data && data.ports) || [];
        usbPortSelect.innerHTML = '';
        if (!ports.length) {
          const none = document.createElement('option');
          none.value = '';
          none.textContent = 'No USB serial devices found';
          usbPortSelect.appendChild(none);
          return;
        }
        ports.forEach((p) => {
          const opt = document.createElement('option');
          opt.value = p.path;
          opt.textContent = (p.label ? p.label + ' — ' : '') + p.path;
          usbPortSelect.appendChild(opt);
        });
        if (previous && ports.some((p) => p.path === previous)) usbPortSelect.value = previous;
      })
      .catch(() => {
        usbPortSelect.innerHTML = '';
        const failed = document.createElement('option');
        failed.value = '';
        failed.textContent = 'Could not list USB ports';
        usbPortSelect.appendChild(failed);
      });
  }

  if (btnRefreshUsb) btnRefreshUsb.addEventListener('click', () => loadUsbPorts());
  loadUsbPorts();

  btnConnect.addEventListener('click', () => {
    const mode = getMode();
    const body = {
      mode,
      outputs: {
        json: outputJson.checked,
        txt: outputTxt.checked,
        tcp: outputTcp.checked,
        graphic: outputGraphic.checked,
      },
    };
    if (mode === 'cloud') {
      body.token = cloudToken.value.trim();
      if (saveCredentials.checked && body.token) {
        fetch(API + '/credentials', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: body.token }),
        }).catch(() => {});
      }
    } else if (mode === 'local') {
      // Local device (TLS TCP) mode.
      body.tcpHost = localHost.value.trim() || undefined;
      body.tcpPort = localPort.value ? parseInt(localPort.value, 10) : undefined;
      body.apiToken = localToken.value.trim() || undefined;
    } else if (mode === 'usb') {
      body.usbPath = usbPortSelect.value || undefined;
      if (!body.usbPath) {
        alert('Pick a USB port first, or click Refresh ports.');
        return;
      }
      if (window.localStorage) localStorage.setItem('usbPort', body.usbPath);
    }
    if (mode === 'ble') {
      body.bleId = bleDeviceSelect.value || undefined;
      body.bleName = bleDeviceSelect.selectedOptions[0] ? bleDeviceSelect.selectedOptions[0].textContent : undefined;
      body.blePassword = blePassword.value;
      if (!body.bleId) {
        alert('Scan for devices and pick one first.');
        return;
      }
      if (!body.blePassword) {
        alert("Enter the device's admin password.");
        return;
      }
      if (window.localStorage) localStorage.setItem('bleDevice', body.bleId);
      bleStatus.textContent = 'Connecting… if your computer asks for a pairing passkey, enter it now.';
    }
    fetch(API + '/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then((res) => res.json())
      .then((data) => {
        if (mode === 'ble') {
          blePassword.value = ''; // never keep it in the page once it has been sent
          bleStatus.textContent = data.ok ? '' : (data.error || 'Connect failed');
        }
        if (!data.ok) {
          if (mode !== 'ble') alert(data.error || 'Connect failed');
          return;
        }
        refreshStats();
      })
      .catch((err) => alert(err.message || 'Connect failed'));
  });

  btnDisconnect.addEventListener('click', () => {
    fetch(API + '/disconnect', { method: 'POST' })
      .then(() => refreshStats())
      .catch(() => refreshStats());
  });

  // -- Bluetooth device mode ---------------------------------------------
  // The server owns the Bluetooth session (src/bleLink.js). The page lists
  // devices, asks the server to connect, and sends device-management
  // requests through it.

  const BLE_PHASES = {
    starting: 'Starting Bluetooth…',
    connecting: 'Connecting… if your computer asks for a pairing passkey, enter it now.',
    authenticating: 'Signing in…',
    reconnecting: 'Link lost — reconnecting…',
  };

  function bleCall(method, params) {
    return fetch(API + '/ble/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, params: params || {} }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (!data.ok) throw new Error(data.error || 'Request failed');
        return data.result;
      });
  }

  function loadBleDevices() {
    btnScanBle.disabled = true;
    bleScanStatus.textContent = 'Scanning…';
    let previous = bleDeviceSelect.value;
    if (!previous && window.localStorage) previous = localStorage.getItem('bleDevice') || '';
    return fetch(API + '/ble/devices')
      .then((res) => res.json())
      .then((data) => {
        if (!data.ok) throw new Error(data.error || 'Scan failed');
        const devices = data.devices || [];
        const others = typeof data.seen === 'number' ? data.seen : null;
        bleDeviceSelect.innerHTML = '';
        if (!devices.length) {
          const none = document.createElement('option');
          none.value = '';
          none.textContent = 'No devices found';
          bleDeviceSelect.appendChild(none);
          bleScanStatus.textContent = 'No ScoreRelay devices found nearby. Make sure the device is powered on and within range.' +
            (others === 0 ? ' (No Bluetooth devices at all were seen — check that Bluetooth is on.)'
              : others ? ' (Bluetooth is working: ' + others + ' other device' + (others === 1 ? '' : 's') + ' seen.)' : '');
          return;
        }
        devices.sort((a, b) => (b.rssi || -999) - (a.rssi || -999));
        devices.forEach((d) => {
          const opt = document.createElement('option');
          opt.value = d.id;
          opt.textContent = d.name + (typeof d.rssi === 'number' ? ' (' + d.rssi + ' dBm)' : '');
          bleDeviceSelect.appendChild(opt);
        });
        if (previous && devices.some((d) => d.id === previous)) bleDeviceSelect.value = previous;
        bleScanStatus.textContent = devices.length + ' found.';
      })
      .catch((err) => {
        bleScanStatus.textContent = err.message || 'Scan failed';
      })
      .then(() => { btnScanBle.disabled = false; });
  }

  btnScanBle.addEventListener('click', loadBleDevices);

  function renderBle(data) {
    const isBle = data.mode === 'ble';
    bleManage.classList.toggle('hidden', !(isBle && data.connected));
    if (!isBle) {
      bleStatus.textContent = '';
      return;
    }
    if (data.connected) {
      bleStatus.textContent = 'Connected to ' + (data.bleDeviceName || 'device') + '.';
    } else if (BLE_PHASES[data.blePhase]) {
      bleStatus.textContent = BLE_PHASES[data.blePhase];
    }
    const d = data.bleDevice || {};
    const parts = [];
    if (d.deviceId) parts.push('ID ' + d.deviceId);
    if (d.firmware) parts.push('firmware ' + d.firmware);
    if (d.wifiIp) parts.push('Wi-Fi ' + d.wifiIp);
    $('ble-device-summary').textContent = parts.join(' · ');
    $('ble-password-change').classList.toggle('hidden', !data.bleMustChangePassword);
    renderRelay(data.bleRelay || { state: 'off' });
  }

  const RELAY_TEXT = {
    off: '',
    unsupported: "This device's firmware doesn't support the cloud relay.",
    not_enabled: 'Off. Turn it on to send this device\'s data to the ScoreRelay cloud through this computer. ' +
      'The device restarts, and while the relay is on it reaches the cloud through this computer instead of Wi-Fi or Ethernet.',
    not_provisioned: "This device isn't set up for the ScoreRelay cloud yet, so there is nothing to relay.",
    active: 'On. This computer is carrying the device\'s cloud connection. Keep this app running and stay in Bluetooth range.',
  };

  function renderRelay(relay) {
    let text = RELAY_TEXT[relay.state];
    if (relay.state === 'active') text += relay.connected ? ' Connected.' : ' Waiting for the device to connect…';
    if (relay.state === 'error') text = 'Problem: ' + (relay.error || 'unknown');
    setText('ble-relay-status', text || '');
    $('btn-ble-relay-on').classList.toggle('hidden', relay.state !== 'not_enabled');
    $('btn-ble-relay-off').classList.toggle('hidden', relay.state !== 'active');
  }

  function setRelay(enabled) {
    const message = enabled
      ? 'Turn on the cloud relay? The device will restart, and while it is on the device reaches the cloud only through this computer.'
      : 'Turn off the cloud relay? The device will restart.';
    if (!confirm(message)) return;
    const button = enabled ? $('btn-ble-relay-on') : $('btn-ble-relay-off');
    busy(button, () =>
      fetch(API + '/ble/relay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (!data.ok) throw new Error(data.error || 'Request failed');
          setText('ble-relay-status', 'Restarting the device… it will reconnect on its own.');
        })
        .catch((err) => setText('ble-relay-status', err.message))
    );
  }

  $('btn-ble-relay-on').addEventListener('click', () => setRelay(true));
  $('btn-ble-relay-off').addEventListener('click', () => setRelay(false));

  function setText(id, text) {
    $(id).textContent = text;
  }

  function busy(button, run) {
    button.disabled = true;
    return Promise.resolve().then(run).finally(() => { button.disabled = false; });
  }

  $('btn-ble-password').addEventListener('click', () => {
    const current = $('ble-pw-current').value;
    const next = $('ble-pw-new').value;
    if (!current || !next) { alert('Enter the current and the new password.'); return; }
    busy($('btn-ble-password'), () =>
      fetch(API + '/ble/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current, next }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (!data.ok) throw new Error(data.error || 'Could not change the password');
          $('ble-pw-current').value = '';
          $('ble-pw-new').value = '';
          refreshStats();
        })
        .catch((err) => alert(err.message))
    );
  });

  $('btn-ble-wifi-scan').addEventListener('click', () => {
    setText('ble-wifi-status', 'Scanning… this can take up to 30 seconds.');
    busy($('btn-ble-wifi-scan'), () =>
      bleCall('scanWifi')
        .then((r) => {
          const select = $('ble-wifi-select');
          select.innerHTML = '';
          const nets = (r && r.networks) || [];
          nets.forEach((n) => {
            const opt = document.createElement('option');
            opt.value = n.ssid;
            opt.textContent = n.ssid + (typeof n.rssi === 'number' ? ' (' + n.rssi + ' dBm)' : '');
            select.appendChild(opt);
          });
          setText('ble-wifi-status', nets.length ? nets.length + ' networks found.' : 'No networks found.');
        })
        .catch((err) => setText('ble-wifi-status', err.message))
    );
  });

  $('btn-ble-wifi-join').addEventListener('click', () => {
    const ssid = $('ble-wifi-select').value;
    if (!ssid) { alert('Scan for networks and pick one first.'); return; }
    busy($('btn-ble-wifi-join'), () =>
      bleCall('configureWifi', { ssid, pass: $('ble-wifi-pass').value })
        .then(() => {
          $('ble-wifi-pass').value = '';
          setText('ble-wifi-status', 'Joining ' + ssid + '…');
          return pollWifiJoin();
        })
        .catch((err) => setText('ble-wifi-status', err.message))
    );
  });

  // The device applies Wi-Fi settings in the background and reports the
  // outcome through its status; wait for a verdict.
  function pollWifiJoin() {
    const started = Date.now();
    function step() {
      return bleCall('getStatus').then((s) => {
        const p = (s && s.wifi_provision) || {};
        if (p.state === 'ok') {
          setText('ble-wifi-status', 'Connected' + (p.detail ? ' (' + p.detail + ')' : '') + '.');
        } else if (p.state === 'reverted') {
          setText('ble-wifi-status', 'Could not join: ' + (p.detail || 'unknown reason') + '. The previous network was restored.');
        } else if (Date.now() - started > 45000) {
          setText('ble-wifi-status', 'Still working — check the connection test in a moment.');
        } else {
          return new Promise((r) => setTimeout(r, 1500)).then(step);
        }
      });
    }
    return step();
  }

  $('btn-ble-nettest').addEventListener('click', () => {
    const out = $('ble-nettest-result');
    out.classList.remove('hidden');
    out.textContent = 'Running… this takes up to 15 seconds.';
    busy($('btn-ble-nettest'), () => {
      function step(tries) {
        return bleCall('networkTest').then((r) => {
          if (r && r.status === 'running' && tries < 10) {
            return new Promise((res) => setTimeout(res, 2000)).then(() => step(tries + 1));
          }
          const lines = [(r && r.overall) ? 'Overall: OK' : 'Overall: problems found'];
          Object.entries((r && r.checks) || {}).forEach(([name, c]) => {
            lines.push((c.ok ? '✓ ' : '✗ ') + name.replace(/_/g, ' ') + (c.detail ? ' — ' + c.detail : ''));
          });
          out.textContent = lines.join('\n');
        });
      }
      return step(0).catch((err) => { out.textContent = err.message; });
    });
  });

  $('btn-ble-ctrl-load').addEventListener('click', () => {
    busy($('btn-ble-ctrl-load'), () =>
      bleCall('getControllerConfig')
        .then((cfg) => {
          $('ble-ctrl-config').value = JSON.stringify(cfg, null, 2);
          $('ble-ctrl-config').classList.remove('hidden');
          $('btn-ble-ctrl-save').classList.remove('hidden');
          setText('ble-ctrl-status', '');
        })
        .catch((err) => setText('ble-ctrl-status', err.message))
    );
  });

  $('btn-ble-ctrl-save').addEventListener('click', () => {
    let cfg;
    try {
      cfg = JSON.parse($('ble-ctrl-config').value);
    } catch (_) {
      setText('ble-ctrl-status', 'That is not valid JSON.');
      return;
    }
    busy($('btn-ble-ctrl-save'), () =>
      bleCall('setControllerConfig', cfg)
        .then(() => setText('ble-ctrl-status', 'Saved.'))
        .catch((err) => setText('ble-ctrl-status', err.message))
    );
  });

  $('btn-ble-reboot').addEventListener('click', () => {
    if (!confirm('Restart the device? It will disconnect and reconnect on its own.')) return;
    busy($('btn-ble-reboot'), () =>
      bleCall('reboot')
        .then(() => setText('ble-action-status', 'Restarting…'))
        .catch((err) => setText('ble-action-status', err.message))
    );
  });

  function showUpdateBanner(latestVersion, url) {
    updateLink.href = url || '#';
    updateLink.textContent = 'v' + latestVersion;
    updateBanner.classList.remove('hidden');
  }

  dismissUpdate.addEventListener('click', () => updateBanner.classList.add('hidden'));

  function doUpdateCheck() {
    fetch(API + '/update-check')
      .then((res) => res.json())
      .then((data) => {
        if (data.updateAvailable && data.latestVersion && data.url) {
          showUpdateBanner(data.latestVersion, data.url);
        }
        if (data.currentVersion) versionEl.textContent = 'v' + data.currentVersion;
      })
      .catch(() => {});
  }

  checkUpdates.addEventListener('click', doUpdateCheck);
  doUpdateCheck();
})();
