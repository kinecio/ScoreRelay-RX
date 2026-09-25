/**
 * Read-only starter templates shipped with the app (public/templates/*.json).
 * Each template is a design-shaped JSON (same shape as a saved design) that
 * the designer can load as a starting point ("New from template").
 */

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'public', 'templates');

function safeId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(id);
}

/** List template summaries (id, name, sport, category, width, height). */
function list() {
  let files = [];
  try {
    files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json'));
  } catch (_) {
    return [];
  }
  const out = [];
  for (const f of files) {
    try {
      const raw = fs.readFileSync(path.join(DIR, f), 'utf8');
      const t = JSON.parse(raw);
      out.push({
        id: path.basename(f, '.json'),
        name: t.name,
        sport: t.sport,
        category: t.category || 'scorebug',
        width: t.width,
        height: t.height,
      });
    } catch (_) {
      // skip corrupt template
    }
  }
  out.sort((a, b) => String(a.sport).localeCompare(String(b.sport)) || String(a.name).localeCompare(String(b.name)));
  return out;
}

/** Get a full template by id. */
function get(id) {
  if (!safeId(id)) return null;
  try {
    const raw = fs.readFileSync(path.join(DIR, id + '.json'), 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

module.exports = { list, get };
