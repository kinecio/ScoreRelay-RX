/**
 * "Cloud" mode client: streams live scoreboard data from the ScoreRelay
 * cloud service using a single access token the user copies from the
 * ScoreRelay cloud portal — never a device password. Consumes the
 * fixed public endpoint from config.js (config.liveGateway) over Server-Sent
 * Events, with automatic reconnect-with-backoff on drop.
 *
 * NOTE: this is the app's client for a cloud service that is still rolling
 * out — see config.js. Until it's live for your account, "Cloud" mode will
 * fail to connect; "Local device" mode is unaffected and always works.
 */

const config = require('./config');
const dataAggregator = require('./dataAggregator');

let controller = null; // AbortController for the current stream request
let connected = false;
let stopped = true;
let token = null;
let reconnectDelayMs = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;

function streamUrl() {
  const { protocol, host, statePath } = config.liveGateway;
  const streamPath = statePath.replace(/\/v1\/state$/, '/v1/stream');
  return `${protocol}://${host}${streamPath}?token=${encodeURIComponent(token)}`;
}

/** Apply one envelope ({v, seq, ts_ms, sport, fields, ...} or {type:"pending"}) to the aggregator. */
function applyEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object') return;
  if (envelope.type === 'pending') return; // token is valid, device just hasn't published yet
  if (envelope.sport) dataAggregator.update('sport', String(envelope.sport));
  const fields = envelope.fields && typeof envelope.fields === 'object' ? envelope.fields : null;
  if (!fields) return;
  for (const [key, value] of Object.entries(fields)) {
    dataAggregator.update(key, value != null ? String(value) : '');
  }
}

/** Parse one SSE "event: X\ndata: Y" block. Returns { event, data } or null. */
function parseSseBlock(block) {
  let event = 'message';
  const dataLines = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (!dataLines.length) return null;
  return { event, data: dataLines.join('\n') };
}

/** Single attempt: open the SSE connection and validate the response. Resolves with the open Response, or throws. */
async function openStreamOnce() {
  controller = new AbortController();
  let res;
  try {
    res = await fetch(streamUrl(), { signal: controller.signal, headers: { Accept: 'text/event-stream' } });
  } catch (err) {
    throw new Error('Could not reach the ScoreRelay cloud service: ' + err.message);
  }
  if (res.status === 401) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error === 'invalid_or_revoked_token' ? 'Invalid or revoked access token' : 'Access denied (401)');
  }
  if (res.status === 429) {
    const err = new Error('This access token already has an active session');
    err.tooManyConnections = true;
    throw err;
  }
  if (!res.ok || !res.body) {
    throw new Error('Cloud service returned HTTP ' + res.status);
  }
  return res;
}

// The cloud service caps session concurrency at 1 per token. Its SSE
// disconnect detection is poll-driven (up to ~15s between checks — see
// live-gateway/backend/public_routes.py's _SSE_DISCONNECT_POLL_SECONDS),
// so a session we ourselves just closed (e.g. Disconnect immediately
// followed by Connect, or a quick app restart) can still look "active" to
// the server for a few seconds after we've genuinely let go of it. Ride
// that out with a short bounded retry rather than surfacing a confusing
// one-shot failure for something that isn't really a bad token — a 429
// that persists past this window means something else actually holds the
// slot (e.g. another client), which still correctly surfaces as an error.
const TOO_MANY_CONNECTIONS_RETRY_MS = 2000;
const TOO_MANY_CONNECTIONS_MAX_WAIT_MS = 20000;

async function openStream() {
  const deadline = Date.now() + TOO_MANY_CONNECTIONS_MAX_WAIT_MS;
  for (;;) {
    try {
      return await openStreamOnce();
    } catch (err) {
      if (stopped || !err.tooManyConnections || Date.now() >= deadline) throw err;
      await new Promise((resolve) => setTimeout(resolve, TOO_MANY_CONNECTIONS_RETRY_MS));
      if (stopped) throw err;
    }
  }
}

/** Read an already-open SSE response until it ends or disconnect() is called. */
async function pumpStream(res, callbacks) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (!stopped) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const parsed = parseSseBlock(block);
      if (!parsed) continue;
      if (parsed.event === 'snapshot' || parsed.event === 'update') {
        try {
          applyEnvelope(JSON.parse(parsed.data));
          callbacks.onMessage && callbacks.onMessage(parsed.event);
        } catch (_) {
          // ignore malformed event payload
        }
      }
    }
  }
}

/** Background loop: keep the stream open, auto-reconnecting with backoff on any drop. */
async function reconnectLoop(callbacks) {
  while (!stopped) {
    try {
      const res = await openStream();
      connected = true;
      reconnectDelayMs = 1000;
      callbacks.onConnect && callbacks.onConnect();
      await pumpStream(res, callbacks);
    } catch (err) {
      callbacks.onError && callbacks.onError(err instanceof Error ? err : new Error(String(err)));
    }
    connected = false;
    if (stopped) break;
    await new Promise((resolve) => setTimeout(resolve, reconnectDelayMs));
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
  }
}

/**
 * Connect to the cloud service with an access token. Resolves once the
 * first connection attempt settles. On success, a background loop keeps the
 * stream alive and auto-reconnects on later drops. On failure (bad token,
 * service unreachable), it does NOT retry in the background — the initial
 * attempt failing usually means the token/service needs attention, not a
 * transient blip, so the caller gets a clean one-shot error and the module
 * returns to a fully disconnected state ready for another connect() call.
 * @param {{ token: string }} options
 * @param {{ onConnect: function?, onError: function?, onMessage: function? }} callbacks
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
function connect(options, callbacks = {}) {
  const t = options && options.token;
  if (!t) return Promise.resolve({ success: false, error: 'Access token required' });
  if (!stopped) return Promise.resolve({ success: false, error: 'Already connected' });

  token = t;
  stopped = false;
  reconnectDelayMs = 1000;

  return openStream().then(
    (res) => {
      connected = true;
      callbacks.onConnect && callbacks.onConnect();
      pumpStream(res, callbacks)
        .catch((err) => callbacks.onError && callbacks.onError(err instanceof Error ? err : new Error(String(err))))
        .then(() => {
          connected = false;
          if (!stopped) reconnectLoop(callbacks);
        });
      return { success: true };
    },
    (err) => {
      connected = false;
      stopped = true;
      token = null;
      return { success: false, error: err.message };
    }
  );
}

function disconnect() {
  stopped = true;
  connected = false;
  token = null;
  if (controller) {
    try {
      controller.abort();
    } catch (_) {}
    controller = null;
  }
}

function isConnected() {
  return connected;
}

module.exports = { connect, disconnect, isConnected };
