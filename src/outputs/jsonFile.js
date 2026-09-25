const fs = require('fs');
const path = require('path');
const dataPath = require('../dataPath');

function write(data) {
  try {
    const { jsonFile } = dataPath.getOutputPaths();
    const dir = path.dirname(jsonFile);
    fs.mkdirSync(dir, { recursive: true });
    const json = JSON.stringify(data, null, 2);
    fs.writeFileSync(jsonFile, json, 'utf8');
  } catch (err) {
    console.error('jsonFile write error:', err.message);
  }
}

module.exports = { write };
