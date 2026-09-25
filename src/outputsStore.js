/**
 * CRUD + show/hide state for "outputs" — named browser-source URLs
 * (/output/:id) that one or more saved designs can be assigned to and
 * independently toggled on/off, so a user can group multiple graphics onto
 * one output or spread them across several. Persisted as a single JSON file.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(process.cwd(), 'graphics-outputs.json');

let cached = null;

function load() {
  if (cached) return cached;
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const data = JSON.parse(raw);
    if (data && Array.isArray(data.outputs)) {
      data.outputs.forEach((o) => {
        if (!Number.isFinite(o.width)) o.width = DEFAULT_WIDTH;
        if (!Number.isFinite(o.height)) o.height = DEFAULT_HEIGHT;
      });
      cached = data;
      return cached;
    }
  } catch (_) {
    // missing or invalid
  }
  cached = { outputs: [] };
  return cached;
}

function persist() {
  fs.writeFileSync(FILE, JSON.stringify(cached, null, 2), 'utf8');
}

function isValidId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(id);
}

/** List all outputs with their assigned graphics. */
function list() {
  return load().outputs;
}

/** Get a single output by id. */
function get(id) {
  if (!isValidId(id)) return null;
  return load().outputs.find((o) => o.id === id) || null;
}

const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;

/**
 * Create a new output (a browser-source channel). Defaults to a 1920x1080
 * (16:9) reference resolution — the coordinate space assigned graphics are
 * positioned in. The /output/:id page scales this reference stage to
 * whatever pixel size OBS/vMix actually gives the browser source.
 */
function create(name) {
  const state = load();
  const output = {
    id: crypto.randomBytes(6).toString('hex'),
    name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : 'Output',
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    graphics: [],
  };
  state.outputs.push(output);
  persist();
  return output;
}

/** Update an output's name and/or reference resolution (width/height). */
function update(id, fields) {
  const output = get(id);
  if (!output) return null;
  const f = fields || {};
  if (typeof f.name === 'string' && f.name.trim()) output.name = f.name.trim().slice(0, 80);
  if (Number.isFinite(f.width)) output.width = Math.max(16, Math.min(7680, Math.round(f.width)));
  if (Number.isFinite(f.height)) output.height = Math.max(16, Math.min(4320, Math.round(f.height)));
  if (output.width == null) output.width = DEFAULT_WIDTH;
  if (output.height == null) output.height = DEFAULT_HEIGHT;
  persist();
  return output;
}

/** Delete an output. */
function remove(id) {
  const state = load();
  const before = state.outputs.length;
  state.outputs = state.outputs.filter((o) => o.id !== id);
  persist();
  return state.outputs.length !== before;
}

/** Assign a design to an output (hidden by default). No-op if already assigned. */
function assign(outputId, designId, position) {
  const output = get(outputId);
  if (!output) return null;
  if (!output.graphics.some((g) => g.designId === designId)) {
    output.graphics.push({
      designId,
      visible: false,
      x: (position && Number.isFinite(position.x)) ? position.x : 0,
      y: (position && Number.isFinite(position.y)) ? position.y : 0,
    });
    persist();
  }
  return output;
}

/** Remove a design assignment from an output. */
function unassign(outputId, designId) {
  const output = get(outputId);
  if (!output) return null;
  output.graphics = output.graphics.filter((g) => g.designId !== designId);
  persist();
  return output;
}

/** Set visibility (show/hide) for a graphic within an output. */
function setVisible(outputId, designId, visible) {
  const output = get(outputId);
  if (!output) return null;
  const g = output.graphics.find((x) => x.designId === designId);
  if (!g) return null;
  g.visible = !!visible;
  persist();
  return output;
}

/** Set the x/y position offset for a graphic within an output. */
function setPosition(outputId, designId, x, y) {
  const output = get(outputId);
  if (!output) return null;
  const g = output.graphics.find((gr) => gr.designId === designId);
  if (!g) return null;
  if (Number.isFinite(x)) g.x = x;
  if (Number.isFinite(y)) g.y = y;
  persist();
  return output;
}

module.exports = {
  list, get, create, update, remove, assign, unassign, setVisible, setPosition, isValidId,
};
