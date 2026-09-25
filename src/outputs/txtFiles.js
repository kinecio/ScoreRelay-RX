const fs = require('fs');
const path = require('path');
const dataPath = require('../dataPath');

function ensureDir() {
  try {
    const baseDir = dataPath.getOutputPaths().txtDir;
    fs.mkdirSync(baseDir, { recursive: true });
  } catch (_) {}
}

function sanitizeFilename(key) {
  return String(key).replace(/[^a-zA-Z0-9_-]/g, '_') || 'field';
}

function write(key, value) {
  ensureDir();
  const baseDir = dataPath.getOutputPaths().txtDir;
  const filename = sanitizeFilename(key) + '.txt';
  const filePath = path.join(baseDir, filename);
  try {
    fs.writeFileSync(filePath, String(value), 'utf8');
  } catch (err) {
    console.error('txtFiles write error:', err.message);
  }
}

/**
 * Remove .txt files in the TXT output directory whose base name (without .txt) is not in the allowed set.
 * Used when sport changes so only the current sport's fields have TXT files.
 * @param {string[]} allowedFieldNames - Field names to keep (e.g. from getFieldsForSport).
 */
function removeFilesNotInSet(allowedFieldNames) {
  const allowedSet = new Set(allowedFieldNames || []);
  try {
    const baseDir = dataPath.getOutputPaths().txtDir;
    if (!fs.existsSync(baseDir)) return;
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isFile() || !ent.name.endsWith('.txt')) continue;
      const baseName = ent.name.slice(0, -4);
      if (!allowedSet.has(baseName)) {
        const filePath = path.join(baseDir, ent.name);
        fs.unlinkSync(filePath);
      }
    }
  } catch (err) {
    console.error('txtFiles removeFilesNotInSet error:', err.message);
  }
}

module.exports = { write, removeFilesNotInSet };
