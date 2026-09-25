/**
 * Shared handling for one ScoreRelay device state message.
 *
 * Every connection mode (cloud gateway, local device, the USB link and
 * Bluetooth) delivers the same envelope:
 *
 *   {"v":1,"seq":42,"type":"state"|"heartbeat","sport":"basketball","fields":{...}}
 *
 * The scoreboard values live under `fields`. An earlier shape used `data`
 * for the same thing, and a flat object of field values is accepted too.
 *
 * This module is the single place that merges such a message into the
 * data aggregator, so the modes can't drift.
 */

const dataAggregator = require('./dataAggregator');

/**
 * Merge one envelope (or a flat field object) into the aggregator.
 * @param {object} obj Parsed message.
 * @param {{ onMessage?: function, onError?: function }} callbacks
 * @returns {boolean} true when the message was a data message and was applied.
 */
function feedEnvelope(obj, callbacks = {}) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;

  if (typeof obj.type === 'string' && obj.type !== 'state' && obj.type !== 'heartbeat' && obj.type !== 'auth_ok') {
    // Unknown control line — ignore (e.g. errors).
    if (obj.type === 'auth_fail') {
      callbacks.onError && callbacks.onError(new Error('Device rejected the API token (auth_fail)'));
    }
    return false;
  }

  if (obj.sport) dataAggregator.update('sport', String(obj.sport));
  const fields = obj.fields && typeof obj.fields === 'object' ? obj.fields
    : obj.data && typeof obj.data === 'object' ? obj.data
      : obj;
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'type' || key === 'seq' || key === 'ts_ms') continue;
    dataAggregator.update(key, value != null ? String(value) : '');
  }
  callbacks.onMessage && callbacks.onMessage(obj);
  return true;
}

module.exports = { feedEnvelope };
