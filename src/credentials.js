const fs = require('fs');
const path = require('path');

const CREDENTIALS_PATH = path.join(
  process.cwd(),
  'credentials.json'
);

/**
 * Load the saved cloud access token from disk. Returns null if file missing
 * or invalid.
 * @returns {{ token: string } | null}
 */
function load() {
  try {
    const raw = fs.readFileSync(CREDENTIALS_PATH, 'utf8');
    const data = JSON.parse(raw);
    if (data && typeof data.token === 'string' && data.token) {
      return { token: data.token };
    }
  } catch (_) {
    // file missing or invalid
  }
  return null;
}

/**
 * Save the cloud access token to disk.
 * @param {string} token
 */
function save(token) {
  const data = JSON.stringify({ token }, null, 2);
  fs.writeFileSync(CREDENTIALS_PATH, data, 'utf8');
}

module.exports = { load, save };
