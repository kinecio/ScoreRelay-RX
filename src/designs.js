/**
 * CRUD storage for user-created graphic designs (Fabric.js canvas JSON + data
 * bindings). Each design is one JSON file under graphics-designs/<id>.json,
 * next to graphics-settings.json (see dataPath.js pattern).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DESIGNS_DIR = path.join(process.cwd(), 'graphics-designs');

function ensureDir() {
  fs.mkdirSync(DESIGNS_DIR, { recursive: true });
}

function fileFor(id) {
  return path.join(DESIGNS_DIR, id + '.json');
}

function isValidId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(id);
}

/**
 * List saved designs (summary only: id, name, sport, width, height, updatedAt).
 * @returns {Array<object>}
 */
function list() {
  ensureDir();
  let files = [];
  try {
    files = fs.readdirSync(DESIGNS_DIR).filter((f) => f.endsWith('.json'));
  } catch (_) {
    return [];
  }
  const out = [];
  for (const f of files) {
    try {
      const raw = fs.readFileSync(path.join(DESIGNS_DIR, f), 'utf8');
      const d = JSON.parse(raw);
      out.push({
        id: d.id,
        name: d.name,
        sport: d.sport,
        width: d.width,
        height: d.height,
        updatedAt: d.updatedAt,
      });
    } catch (_) {
      // skip corrupt file
    }
  }
  out.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return out;
}

/**
 * Get a single design's full contents.
 * @param {string} id
 * @returns {object|null}
 */
function get(id) {
  if (!isValidId(id)) return null;
  try {
    const raw = fs.readFileSync(fileFor(id), 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

/**
 * Create a new design.
 * @param {{ name: string, sport?: string, width?: number, height?: number, background?: string, canvas?: object, bindings?: Array, fonts?: Array }} body
 * @returns {object} saved design
 */
function create(body) {
  ensureDir();
  const id = crypto.randomBytes(8).toString('hex');
  const design = sanitize(body, id);
  fs.writeFileSync(fileFor(id), JSON.stringify(design, null, 2), 'utf8');
  return design;
}

/**
 * Update an existing design (full replace of editable fields).
 * @param {string} id
 * @param {object} body
 * @returns {object|null} saved design, or null if id not found
 */
function update(id, body) {
  if (!isValidId(id)) return null;
  ensureDir();
  if (!fs.existsSync(fileFor(id))) return null;
  const design = sanitize(body, id);
  fs.writeFileSync(fileFor(id), JSON.stringify(design, null, 2), 'utf8');
  return design;
}

function sanitize(body, id) {
  const b = body && typeof body === 'object' ? body : {};
  return {
    id,
    name: typeof b.name === 'string' && b.name.trim() ? b.name.trim().slice(0, 120) : 'Untitled graphic',
    sport: typeof b.sport === 'string' ? b.sport : 'generic',
    width: Number.isFinite(b.width) ? Math.max(1, Math.min(7680, Math.round(b.width))) : 1920,
    height: Number.isFinite(b.height) ? Math.max(1, Math.min(4320, Math.round(b.height))) : 1080,
    background: typeof b.background === 'string' ? b.background : 'transparent',
    canvas: b.canvas && typeof b.canvas === 'object' ? b.canvas : { objects: [] },
    bindings: Array.isArray(b.bindings) ? b.bindings : [],
    fonts: Array.isArray(b.fonts) ? b.fonts : [],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Delete a design by id.
 * @param {string} id
 * @returns {boolean} true if deleted
 */
function remove(id) {
  if (!isValidId(id)) return false;
  try {
    fs.unlinkSync(fileFor(id));
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = { list, get, create, update, remove, isValidId };
