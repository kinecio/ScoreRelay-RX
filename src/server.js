const path = require('path');
const express = require('express');
const { findAvailablePort } = require('./portFinder');
const credentials = require('./credentials');
const dataPath = require('./dataPath');
const connectionEngine = require('./connectionEngine');
const usbLink = require('./usbLink');
const bleLink = require('./bleLink');
const dataAggregator = require('./dataAggregator');
const scoreGraphicRender = require('./outputs/scoreGraphicRender');
const graphicsSettings = require('./graphicsSettings');
const designs = require('./designs');
const outputsStore = require('./outputsStore');
const sportFields = require('./sportFields');
const templates = require('./templates');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/graphics', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'graphics.html'));
});

app.get('/designer', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'designer.html'));
});

app.get('/controller', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'controller.html'));
});

app.get('/output/:id', (req, res) => {
  if (!outputsStore.isValidId(req.params.id)) return res.status(404).send('Not found');
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, '..', 'public', 'output.html'));
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/credentials', (_req, res) => {
  const creds = credentials.load();
  res.json(creds ? { token: creds.token } : {});
});

app.post('/api/credentials', (req, res) => {
  const { token } = req.body || {};
  if (typeof token !== 'string' || !token) {
    return res.status(400).json({ error: 'token is required' });
  }
  credentials.save(token);
  res.json({ ok: true });
});

app.get('/api/data-path', (_req, res) => {
  res.json({ dataPath: dataPath.getDataDir() });
});

app.post('/api/data-path', (req, res) => {
  const pathValue = req.body?.dataPath ?? req.body?.path;
  if (typeof pathValue !== 'string' || !pathValue.trim()) {
    return res.status(400).json({ error: 'dataPath is required' });
  }
  dataPath.setDataDir(pathValue.trim());
  res.json({ ok: true });
});

// Bluetooth mode signs in to the device and can change its settings, so those
// requests are only accepted from this computer. (The web server listens on
// every interface; other machines on the network must not be able to steer a
// device through this app's Bluetooth link.) The Host check stops a web page
// from reaching these routes through a rebound DNS name.
const LOCAL_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function isLocalRequest(req) {
  const host = String(req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
  return LOCAL_ADDRESSES.has(req.socket.remoteAddress) && LOCAL_HOSTS.has(host);
}

function requireLocal(req, res, next) {
  if (isLocalRequest(req)) return next();
  return res.status(403).json({ ok: false, error: 'Bluetooth controls are only available from this computer' });
}

app.post('/api/connect', (req, res) => {
  const body = req.body || {};
  const mode = body.mode === 'local' ? 'local' : body.mode === 'tcp' ? 'tcp' : body.mode === 'usb' ? 'usb' : body.mode === 'ble' ? 'ble' : 'cloud';
  if (mode === 'ble' && !isLocalRequest(req)) {
    return res.status(403).json({ ok: false, error: 'Bluetooth controls are only available from this computer' });
  }
  const outputs = {
    json: !!body.outputs?.json,
    txt: !!body.outputs?.txt,
    tcp: !!body.outputs?.tcp,
    graphic: !!body.outputs?.graphic,
  };
  const options = {
    mode,
    outputs,
    token: body.token != null ? body.token : credentials.load()?.token,
    tcpHost: body.tcpHost,
    tcpPort: body.tcpPort,
    apiToken: body.apiToken,
    usbPath: body.usbPath,
    bleId: body.bleId,
    bleName: body.bleName,
    blePassword: body.blePassword,
  };
  connectionEngine.connect(options).then((result) => {
    if (result.success) res.json({ ok: true });
    else res.status(400).json({ ok: false, error: result.error });
  }).catch((err) => {
    res.status(500).json({ ok: false, error: err.message });
  });
});

app.post('/api/disconnect', (_req, res) => {
  connectionEngine.disconnect();
  res.json({ ok: true });
});

// -- USB device mode -----------------------------------------------------
// The server owns the device's serial port (src/usbLink.js) so the
// connection stays up whether or not a browser window is open. The page
// only lists ports and asks the server to open/close one.

app.get('/api/usb/ports', (_req, res) => {
  usbLink.listPorts()
    .then((ports) => res.json({ ports }))
    .catch((err) => res.status(500).json({ ok: false, error: err.message || 'Failed to list USB ports' }));
});

app.post('/api/usb/open', (req, res) => {
  const path = req.body && typeof req.body.path === 'string' ? req.body.path.trim() : '';
  if (!path) return res.status(400).json({ ok: false, error: 'path is required' });
  connectionEngine.connect({ mode: 'usb', usbPath: path, outputs: req.body.outputs }).then((result) => {
    if (result.success) res.json({ ok: true });
    else res.status(400).json({ ok: false, error: result.error });
  }).catch((err) => res.status(500).json({ ok: false, error: err.message }));
});

app.post('/api/usb/close', (_req, res) => {
  connectionEngine.disconnect();
  res.json({ ok: true });
});

// -- Bluetooth device mode ----------------------------------------------
// Scanning and the session itself live in src/bleLink.js. Connecting goes
// through /api/connect like every other mode.

function bleFailure(res, err) {
  res.status(err && err.code === 'not_allowed' ? 403 : 400).json({
    ok: false,
    error: (err && err.message) || 'Bluetooth request failed',
    code: (err && err.code) || null,
  });
}

app.get('/api/ble/devices', requireLocal, (req, res) => {
  const ms = Math.max(1000, Math.min(parseInt(req.query.ms, 10) || 6000, 20000));
  bleLink.scan(ms)
    .then((found) => res.json({ ok: true, devices: found.devices, seen: found.seen }))
    .catch((err) => bleFailure(res, err));
});

app.post('/api/ble/call', requireLocal, (req, res) => {
  const { method, params } = req.body || {};
  if (typeof method !== 'string') return res.status(400).json({ ok: false, error: 'method is required' });
  bleLink.call(method, params && typeof params === 'object' ? params : {})
    .then((result) => res.json({ ok: true, result }))
    .catch((err) => bleFailure(res, err));
});

app.post('/api/ble/password', requireLocal, (req, res) => {
  const { current, next } = req.body || {};
  if (typeof current !== 'string' || typeof next !== 'string' || !current || !next) {
    return res.status(400).json({ ok: false, error: 'current and next are required' });
  }
  bleLink.changePassword(current, next)
    .then(() => res.json({ ok: true }))
    .catch((err) => bleFailure(res, err));
});

app.post('/api/ble/relay', requireLocal, (req, res) => {
  const enabled = req.body && req.body.enabled;
  if (typeof enabled !== 'boolean') return res.status(400).json({ ok: false, error: 'enabled (boolean) is required' });
  bleLink.setRelay(enabled)
    .then(() => res.json({ ok: true }))
    .catch((err) => bleFailure(res, err));
});

app.get('/api/stats', (_req, res) => {
  res.json({ ...connectionEngine.getStats(), graphicsSettings: graphicsSettings.get() });
});

app.post('/api/raw-data', (req, res) => {
  const rawData = req.body?.rawData;
  if (typeof rawData !== 'boolean') {
    return res.status(400).json({ ok: false, error: 'rawData (boolean) required' });
  }
  dataAggregator.setRawDataMode(rawData);
  res.json({ ok: true, rawDataMode: dataAggregator.getRawDataMode() });
});

app.get('/api/update-check', (_req, res) => {
  const updater = require('./updater');
  updater.check().then((result) => {
    res.json(result);
  }).catch((err) => {
    res.status(500).json({ error: err.message });
  });
});

app.get('/graphic', (_req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  const data = dataAggregator.getData();
  const gs = graphicsSettings.get();
  const sport = gs.autoSport ? (data.sport || null) : (gs.testSport || null);
  const html = scoreGraphicRender.render(sport, data, { effectiveSport: sport });
  res.type('html').send(html);
});

app.get('/api/graphics-settings', (_req, res) => {
  res.json(graphicsSettings.get());
});

app.post('/api/graphics-settings', (req, res) => {
  const body = req.body || {};
  if (typeof body !== 'object') {
    return res.status(400).json({ error: 'JSON body required' });
  }
  graphicsSettings.set(body);
  res.json(graphicsSettings.get());
});

// --- Data fields catalog (for the designer's data-binding picker) ---

app.get('/api/fields', (req, res) => {
  const sport = typeof req.query.sport === 'string' ? req.query.sport.toLowerCase() : '';
  if (sport && sportFields.VALID_SPORTS.includes(sport)) {
    res.json({ sport, fields: ['sport', ...Array.from(sportFields.getFieldsForSport(sport))] });
    return;
  }
  const all = new Set(['sport']);
  sportFields.VALID_SPORTS.forEach((s) => {
    sportFields.getFieldsForSport(s).forEach((f) => all.add(f));
  });
  res.json({ sport: null, sports: sportFields.VALID_SPORTS, fields: Array.from(all).sort() });
});

// --- Templates (read-only, shipped with the app) ---

app.get('/api/templates', (_req, res) => {
  res.json(templates.list());
});

app.get('/api/templates/:id', (req, res) => {
  const t = templates.get(req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  res.json(t);
});

// --- Designs (saved graphics) ---

app.get('/api/designs', (_req, res) => {
  res.json(designs.list());
});

app.get('/api/designs/:id', (req, res) => {
  const d = designs.get(req.params.id);
  if (!d) return res.status(404).json({ error: 'not found' });
  res.json(d);
});

app.post('/api/designs', (req, res) => {
  res.json(designs.create(req.body || {}));
});

app.put('/api/designs/:id', (req, res) => {
  const d = designs.update(req.params.id, req.body || {});
  if (!d) return res.status(404).json({ error: 'not found' });
  res.json(d);
});

app.delete('/api/designs/:id', (req, res) => {
  const ok = designs.remove(req.params.id);
  if (!ok) return res.status(404).json({ error: 'not found' });
  outputsStore.list().forEach((o) => outputsStore.unassign(o.id, req.params.id));
  res.json({ ok: true });
});

// --- Outputs (browser-source channels) + on/off control ---

app.get('/api/outputs', (_req, res) => {
  res.json(outputsStore.list());
});

app.post('/api/outputs', (req, res) => {
  res.json(outputsStore.create(req.body && req.body.name));
});

app.put('/api/outputs/:id', (req, res) => {
  const o = outputsStore.update(req.params.id, req.body || {});
  if (!o) return res.status(404).json({ error: 'not found' });
  res.json(o);
});

app.delete('/api/outputs/:id', (req, res) => {
  const ok = outputsStore.remove(req.params.id);
  if (!ok) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

app.post('/api/outputs/:id/graphics', (req, res) => {
  const designId = req.body && req.body.designId;
  if (!designs.isValidId(designId) || !designs.get(designId)) {
    return res.status(400).json({ error: 'valid designId required' });
  }
  const o = outputsStore.assign(req.params.id, designId, req.body);
  if (!o) return res.status(404).json({ error: 'output not found' });
  res.json(o);
});

app.delete('/api/outputs/:id/graphics/:designId', (req, res) => {
  const o = outputsStore.unassign(req.params.id, req.params.designId);
  if (!o) return res.status(404).json({ error: 'not found' });
  res.json(o);
});

app.post('/api/outputs/:id/graphics/:designId/show', (req, res) => {
  const o = outputsStore.setVisible(req.params.id, req.params.designId, true);
  if (!o) return res.status(404).json({ error: 'not found' });
  res.json(o);
});

app.post('/api/outputs/:id/graphics/:designId/hide', (req, res) => {
  const o = outputsStore.setVisible(req.params.id, req.params.designId, false);
  if (!o) return res.status(404).json({ error: 'not found' });
  res.json(o);
});

app.post('/api/outputs/:id/graphics/:designId/toggle', (req, res) => {
  const output = outputsStore.get(req.params.id);
  if (!output) return res.status(404).json({ error: 'not found' });
  const g = output.graphics.find((x) => x.designId === req.params.designId);
  if (!g) return res.status(404).json({ error: 'not assigned' });
  const o = outputsStore.setVisible(req.params.id, req.params.designId, !g.visible);
  res.json(o);
});

app.post('/api/outputs/:id/graphics/:designId/position', (req, res) => {
  const o = outputsStore.setPosition(req.params.id, req.params.designId, req.body && req.body.x, req.body && req.body.y);
  if (!o) return res.status(404).json({ error: 'not found' });
  res.json(o);
});

// Full render payload for an output's live browser-source page: assigned
// graphics with their full canvas JSON + bindings, so /output/:id only needs
// to poll this (structure) and /api/stats (live data).
app.get('/api/outputs/:id/full', (req, res) => {
  const output = outputsStore.get(req.params.id);
  if (!output) return res.status(404).json({ error: 'not found' });
  const graphics = output.graphics.map((g) => {
    const d = designs.get(g.designId);
    if (!d) return null;
    return { ...g, design: d };
  }).filter(Boolean);
  res.json({ id: output.id, name: output.name, width: output.width, height: output.height, graphics });
});

const server = require('http').createServer(app);

// Resolves with the port once listening. The desktop shell (electron/main.js)
// waits on this to know where to point its window.
const ready = findAvailablePort(server).then((port) => {
  if (port == null) {
    console.error('No available port found. Tried:', require('./config').webPorts);
    process.exit(1);
  }
  console.log('ScoreRelay-RX web server running at http://localhost:' + port);
  console.log('Port:', port);
  return port;
});

module.exports = { ready };
