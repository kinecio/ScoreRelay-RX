/**
 * Load/save graphics settings (accent color, which elements to show).
 * Stored in graphics-settings.json next to data-path.json.
 */

const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = path.join(process.cwd(), 'graphics-settings.json');

const DEFAULT_ELEMENTS = {
  teams: true,
  awayScore: true,
  homeScore: true,
  inning: true,
  count: true,
  outs: true,
  clock: false,
};

const VALID_SPORTS = ['baseball', 'basketball', 'football', 'soccer', 'volleyball'];

const MANUAL_FIELD_IDS = ['guestTeamName', 'homeTeamName', 'guestScore', 'homeScore', 'inning', 'topBottom', 'ball', 'strike', 'out', 'clock'];

const DEFAULT_FIELD_OVERRIDES = Object.fromEntries(MANUAL_FIELD_IDS.map((id) => [id, false]));

const DEFAULT_MANUAL_VALUES = {
  guestTeamName: '',
  homeTeamName: '',
  guestScore: 0,
  homeScore: 0,
  inning: 1,
  topBottom: 'top',
  ball: 0,
  strike: 0,
  out: 0,
  clock: '',
};

const DEFAULTS = {
  accentColor: '#00ff41',
  elements: { ...DEFAULT_ELEMENTS },
  autoSport: true,
  testSport: 'baseball',
  fieldOverrides: { ...DEFAULT_FIELD_OVERRIDES },
  manualValues: { ...DEFAULT_MANUAL_VALUES },
  template: 'simple',
  logoUrl: '',
  logoBoxColor: '#ffffff',
};

let cached = null;

function load() {
  if (cached) return cached;
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (data && typeof data === 'object') {
      const testSport = typeof data.testSport === 'string' && VALID_SPORTS.includes(data.testSport)
        ? data.testSport
        : DEFAULTS.testSport;
      const fieldOverrides = data.fieldOverrides && typeof data.fieldOverrides === 'object'
        ? { ...DEFAULT_FIELD_OVERRIDES, ...data.fieldOverrides }
        : { ...DEFAULT_FIELD_OVERRIDES };
      const manualValues = data.manualValues && typeof data.manualValues === 'object'
        ? { ...DEFAULT_MANUAL_VALUES, ...data.manualValues }
        : { ...DEFAULT_MANUAL_VALUES };
      if (data.guestTeamName !== undefined && typeof data.guestTeamName === 'string') manualValues.guestTeamName = data.guestTeamName;
      if (data.homeTeamName !== undefined && typeof data.homeTeamName === 'string') manualValues.homeTeamName = data.homeTeamName;
      if (typeof data.guestTeamName === 'string' && data.guestTeamName.trim() !== '') fieldOverrides.guestTeamName = true;
      if (typeof data.homeTeamName === 'string' && data.homeTeamName.trim() !== '') fieldOverrides.homeTeamName = true;
      const template = data.template === 'logo' ? 'logo' : 'simple';
      const logoUrl = typeof data.logoUrl === 'string' ? data.logoUrl : DEFAULTS.logoUrl;
      const logoBoxColor = typeof data.logoBoxColor === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(data.logoBoxColor.trim()) ? data.logoBoxColor.trim() : DEFAULTS.logoBoxColor;
      cached = {
        accentColor: typeof data.accentColor === 'string' ? data.accentColor : DEFAULTS.accentColor,
        elements: data.elements && typeof data.elements === 'object'
          ? { ...DEFAULT_ELEMENTS, ...data.elements }
          : { ...DEFAULT_ELEMENTS },
        autoSport: data.autoSport !== false,
        testSport,
        fieldOverrides,
        manualValues,
        template,
        logoUrl,
        logoBoxColor,
      };
      return cached;
    }
  } catch (_) {
    // file missing or invalid
  }
  cached = {
    accentColor: DEFAULTS.accentColor,
    elements: { ...DEFAULT_ELEMENTS },
    autoSport: DEFAULTS.autoSport,
    testSport: DEFAULTS.testSport,
    fieldOverrides: { ...DEFAULT_FIELD_OVERRIDES },
    manualValues: { ...DEFAULT_MANUAL_VALUES },
    template: DEFAULTS.template,
    logoUrl: DEFAULTS.logoUrl,
    logoBoxColor: DEFAULTS.logoBoxColor,
  };
  return cached;
}

/**
 * Get current graphics settings (accent color and element toggles).
 * @returns {{ accentColor: string, elements: Record<string, boolean> }}
 */
function get() {
  return load();
}

/**
 * Save graphics settings.
 * @param {{ accentColor?: string, elements?: Record<string, boolean> }} settings
 */
function set(settings) {
  const current = load();
  if (settings.accentColor != null && typeof settings.accentColor === 'string') {
    current.accentColor = settings.accentColor;
  }
  if (settings.elements != null && typeof settings.elements === 'object') {
    current.elements = { ...current.elements, ...settings.elements };
  }
  if (settings.autoSport !== undefined) {
    current.autoSport = !!settings.autoSport;
  }
  if (settings.testSport != null && typeof settings.testSport === 'string' && VALID_SPORTS.includes(settings.testSport)) {
    current.testSport = settings.testSport;
  }
  if (settings.fieldOverrides != null && typeof settings.fieldOverrides === 'object') {
    current.fieldOverrides = { ...current.fieldOverrides, ...settings.fieldOverrides };
  }
  if (settings.manualValues != null && typeof settings.manualValues === 'object') {
    current.manualValues = { ...current.manualValues, ...settings.manualValues };
  }
  if (settings.template === 'simple' || settings.template === 'logo') {
    current.template = settings.template;
  }
  if (settings.logoUrl !== undefined && typeof settings.logoUrl === 'string') {
    current.logoUrl = settings.logoUrl;
  }
  if (settings.logoBoxColor !== undefined && typeof settings.logoBoxColor === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(settings.logoBoxColor.trim())) {
    current.logoBoxColor = settings.logoBoxColor.trim();
  }
  cached = current;
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(cached, null, 2), 'utf8');
}

module.exports = { get, set, load, VALID_SPORTS, MANUAL_FIELD_IDS, DEFAULT_MANUAL_VALUES };
