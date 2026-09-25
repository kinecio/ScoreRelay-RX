const https = require('https');
const config = require('./config');
const pkg = require('../package.json');

const currentVersion = (pkg.version || '0.0.0').replace(/^v/, '');

/**
 * Compare two semver-like strings (e.g. 1.0.0 vs 1.0.1). Returns true if latest > current.
 */
function isNewer(latest, current) {
  const a = (latest || '').replace(/^v/, '').split('.').map(Number);
  const b = (current || '').replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

/**
 * Check GitHub releases for a newer version.
 * @returns {Promise<{ updateAvailable: boolean, currentVersion: string, latestVersion?: string, url?: string }>}
 */
function check() {
  const [owner, repo] = (config.githubRepo || '').split('/').filter(Boolean);
  if (!owner || !repo) {
    return Promise.resolve({
      updateAvailable: false,
      currentVersion,
      error: 'GitHub repo not configured',
    });
  }

  const path = `/repos/${owner}/${repo}/releases/latest`;
  const opts = {
    hostname: 'api.github.com',
    path,
    method: 'GET',
    headers: { 'User-Agent': 'ScoreRelay-RX' },
  };

  return new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          resolve({
            updateAvailable: false,
            currentVersion,
            error: res.statusCode === 404 ? 'No releases found' : `HTTP ${res.statusCode}`,
          });
          return;
        }
        try {
          const json = JSON.parse(data);
          const latestVersion = (json.tag_name || json.name || '').replace(/^v/, '');
          const updateAvailable = isNewer(latestVersion, currentVersion);
          resolve({
            updateAvailable,
            currentVersion,
            latestVersion: latestVersion || undefined,
            url: json.html_url || (latestVersion ? `https://github.com/${owner}/${repo}/releases` : undefined),
          });
        } catch (e) {
          resolve({ updateAvailable: false, currentVersion, error: e.message });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
    req.end();
  });
}

module.exports = { check, currentVersion };
