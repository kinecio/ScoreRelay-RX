/**
 * Current sport state, as reported by the device.
 * Parses JSON, validates sport, and notifies dataAggregator on change.
 */

const sportFields = require('./sportFields');

let currentSport = null;
let settings = null;

/**
 * Parse settings payload and update current sport. On change, notifies dataAggregator.
 * @param {string} payload - JSON string (e.g. {"manufacturer":"daktronics","model":"5000","sport":"basketball","input_type":"cl"}).
 */
function setSportFromSettings(payload) {
  if (typeof payload !== 'string' || !payload.trim()) {
    console.warn('sportSettings: empty payload');
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch (err) {
    console.warn('sportSettings: malformed JSON', err.message);
    return;
  }
  if (!parsed || typeof parsed !== 'object') {
    console.warn('sportSettings: payload is not an object');
    return;
  }
  const sport = typeof parsed.sport === 'string' ? parsed.sport.trim().toLowerCase() : null;
  const valid = sport && sportFields.VALID_SPORTS.includes(sport);
  const newSport = valid ? sport : null;
  if (newSport !== currentSport) {
    currentSport = newSport;
    settings = parsed;
    const dataAggregator = require('./dataAggregator');
    dataAggregator.onSportChange(currentSport);
  } else {
    settings = parsed;
  }
}

/**
 * Set current sport from a value in the data feed (e.g. raw JSON "sport": "football").
 * Use when the feed includes a sport field instead of or in addition to a separate settings topic.
 * @param {string} value - Sport name (e.g. "football", "Football").
 */
function setSportFromValue(value) {
  const sport = typeof value === 'string' ? value.trim().toLowerCase() : null;
  const valid = sport && sportFields.VALID_SPORTS.includes(sport);
  const newSport = valid ? sport : null;
  if (newSport !== currentSport) {
    currentSport = newSport;
    settings = settings ? { ...settings, sport: currentSport } : { sport: currentSport };
    const dataAggregator = require('./dataAggregator');
    dataAggregator.onSportChange(currentSport);
  } else if (newSport) {
    settings = settings ? { ...settings, sport: newSport } : { sport: newSport };
  }
}

function getCurrentSport() {
  return currentSport;
}

function getSettings() {
  return settings ? { ...settings } : null;
}

/**
 * Reset sport (e.g. on disconnect). Caller is responsible for clearing aggregator if needed.
 */
function reset() {
  currentSport = null;
  settings = null;
}

module.exports = {
  setSportFromSettings,
  setSportFromValue,
  getCurrentSport,
  getSettings,
  reset,
};
