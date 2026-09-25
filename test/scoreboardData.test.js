'use strict';

// Verifies the shared envelope handling used by every connection mode,
// without touching disk: the data aggregator is stubbed via the module cache
// so we can assert exactly which key/value updates a message produces.

const test = require('node:test');
const assert = require('node:assert');

const aggPath = require.resolve('../src/dataAggregator');
const updates = [];
require.cache[aggPath] = {
  id: aggPath,
  filename: aggPath,
  loaded: true,
  exports: { update: (key, value) => updates.push([key, value]) },
};

const { feedEnvelope } = require('../src/scoreboardData');

function reset() {
  updates.length = 0;
}

test('state envelope merges sport and inner data fields', () => {
  reset();
  const seen = [];
  const applied = feedEnvelope(
    { type: 'state', sport: 'basketball', data: { home_score: 10, away_score: 8 } },
    { onMessage: (m) => seen.push(m) }
  );
  assert.strictEqual(applied, true);
  assert.deepStrictEqual(updates, [['sport', 'basketball'], ['home_score', '10'], ['away_score', '8']]);
  assert.strictEqual(seen.length, 1);
});

test('heartbeat and flat objects are accepted; unknown/!object messages are not', () => {
  reset();
  assert.strictEqual(feedEnvelope({ type: 'heartbeat', sport: 'soccer', data: {} }), true);
  assert.deepStrictEqual(updates, [['sport', 'soccer']]);

  reset();
  assert.strictEqual(feedEnvelope({ home_score: 3 }), true); // flat field object
  assert.deepStrictEqual(updates, [['home_score', '3']]);

  reset();
  assert.strictEqual(feedEnvelope({ type: 'something_else' }), false);
  assert.strictEqual(feedEnvelope(null), false);
  assert.strictEqual(feedEnvelope([1, 2]), false);
  assert.deepStrictEqual(updates, []);
});

test('null values become empty strings, control keys are skipped', () => {
  reset();
  feedEnvelope({ type: 'state', data: { home_score: null, seq: 4, ts_ms: 123, period: 2 } });
  assert.deepStrictEqual(updates, [['home_score', ''], ['period', '2']]);
});

test('the device envelope keeps its values under "fields" (not "data")', () => {
  reset();
  const applied = feedEnvelope({
    v: 1, seq: 7, ts_ms: 123, type: 'state', sport: 'basketball',
    fields: { home_score: '21', clock: '04:05' },
  });
  assert.strictEqual(applied, true);
  assert.deepStrictEqual(updates, [['sport', 'basketball'], ['home_score', '21'], ['clock', '04:05']]);
});
