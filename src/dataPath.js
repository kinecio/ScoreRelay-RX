const fs = require('fs');
const path = require('path');
const config = require('./config');

const SETTINGS_FILE = path.join(process.cwd(), 'data-path.json');
let cachedPath = null;

/**
 * Load data path from settings file or use default.
 * @returns {string} Current data directory path
 */
function load() {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (data && typeof data.dataPath === 'string' && data.dataPath.trim()) {
      cachedPath = data.dataPath.trim();
      return cachedPath;
    }
  } catch (_) {
    // file missing or invalid
  }
  cachedPath = config.defaultDataDir;
  return cachedPath;
}

/**
 * Get the current data directory (loads from file on first call).
 * @returns {string}
 */
function getDataDir() {
  if (cachedPath === null) load();
  return cachedPath;
}

/**
 * Save a new data path and update in-memory cache.
 * @param {string} dir Full path to the data folder
 */
function setDataDir(dir) {
  const trimmed = typeof dir === 'string' ? dir.trim() : '';
  if (!trimmed) return;
  cachedPath = trimmed;
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ dataPath: trimmed }, null, 2), 'utf8');
}

/**
 * Get output paths for JSON file, TXT directory, and score graphic (used by output modules).
 * @returns {{ jsonFile: string, txtDir: string, graphicFile: string }}
 */
function getOutputPaths() {
  const d = getDataDir();
  return {
    jsonFile: path.join(d, 'scorerelay-data.json'),
    txtDir: d,
    graphicFile: path.join(d, 'score-graphic.html'),
  };
}

module.exports = { load, getDataDir, setDataDir, getOutputPaths };
