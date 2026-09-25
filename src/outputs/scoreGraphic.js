/**
 * Score graphic file output. Writes HTML to score-graphic.html when graphic output is enabled.
 * Uses render(sport, data) so template (simple vs logo) and sport (baseball, basketball for logo) are respected.
 */

const fs = require('fs');
const path = require('path');
const dataPath = require('../dataPath');
const scoreGraphicRender = require('./scoreGraphicRender');
const graphicsSettings = require('../graphicsSettings');

function write(data) {
  const gs = graphicsSettings.get();
  const sport = gs.autoSport ? (data && data.sport) : gs.testSport;
  const template = gs.template === 'logo' ? 'logo' : 'simple';
  const supportedForWrite = template === 'logo'
    ? (sport === 'baseball' || sport === 'basketball')
    : (sport === 'baseball');
  if (!supportedForWrite) {
    return;
  }
  try {
    const { graphicFile } = dataPath.getOutputPaths();
    const dir = path.dirname(graphicFile);
    fs.mkdirSync(dir, { recursive: true });
    const html = scoreGraphicRender.render(sport, data);
    fs.writeFileSync(graphicFile, html, 'utf8');
  } catch (err) {
    console.error('scoreGraphic write error:', err.message);
  }
}

module.exports = { write };
