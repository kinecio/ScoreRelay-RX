/**
 * In-memory key/value store for scoreboard data. Notifies enabled outputs on update.
 * Only stores and emits fields allowed for the current sport (from .../settings).
 */

const config = require('./config');
const jsonFileOutput = require('./outputs/jsonFile');
const txtFilesOutput = require('./outputs/txtFiles');
const tcpServerOutput = require('./outputs/tcpServer');
const scoreGraphicOutput = require('./outputs/scoreGraphic');
const sportSettings = require('./sportSettings');
const sportFields = require('./sportFields');

let data = {};
let outputFlags = { json: false, txt: false, tcp: false, graphic: false };
let rawDataMode = false;

function getData() {
  if (rawDataMode) {
    return { ...data };
  }
  const sport = sportSettings.getCurrentSport();
  const allowed = sportFields.getFieldsForSport(sport);
  const out = { sport: sport };
  if (allowed) {
    for (const key of Object.keys(data)) {
      if (allowed.has(key)) out[key] = data[key];
    }
  }
  return out;
}

function update(key, value) {
  if (key === 'sport') {
    sportSettings.setSportFromValue(value);
  }
  if (!rawDataMode) {
    const sport = sportSettings.getCurrentSport();
    const allowed = sportFields.getFieldsForSport(sport);
    const allowKey = allowed && (allowed.has(key) || key === 'sport');
    if (!allowKey) return;
  }
  data[key] = value;
  if (outputFlags.json) jsonFileOutput.write(getData());
  if (outputFlags.txt) txtFilesOutput.write(key, value);
  if (outputFlags.tcp) tcpServerOutput.broadcast(getData());
  if (outputFlags.graphic) scoreGraphicOutput.write(getData());
}

function setRawDataMode(value) {
  rawDataMode = !!value;
  if (outputFlags.json) jsonFileOutput.write(getData());
  if (outputFlags.txt) {
    if (rawDataMode) {
      Object.entries(data).forEach(([k, v]) => txtFilesOutput.write(k, v));
    } else {
      const allowed = sportFields.getFieldsForSport(sportSettings.getCurrentSport());
      Object.entries(data).forEach(([k, v]) => {
        if (allowed && allowed.has(k)) txtFilesOutput.write(k, v);
      });
      txtFilesOutput.removeFilesNotInSet(allowed ? Array.from(allowed) : []);
    }
  }
  if (outputFlags.tcp) tcpServerOutput.broadcast(getData());
  if (outputFlags.graphic) scoreGraphicOutput.write(getData());
}

function getRawDataMode() {
  return rawDataMode;
}

/**
 * Called when sport is set or changed from .../settings. Clears non-allowed keys and removes their TXT files.
 * @param {string|null} newSport - New sport (e.g. 'basketball') or null.
 */
function onSportChange(newSport) {
  if (rawDataMode) return;
  const allowed = sportFields.getFieldsForSport(newSport);
  const toRemove = [];
  for (const key of Object.keys(data)) {
    if (!allowed || !allowed.has(key)) toRemove.push(key);
  }
  toRemove.forEach((k) => delete data[k]);
  txtFilesOutput.removeFilesNotInSet(allowed ? Array.from(allowed) : []);
  if (outputFlags.json) jsonFileOutput.write(getData());
  if (outputFlags.tcp) tcpServerOutput.broadcast(getData());
  if (outputFlags.graphic) scoreGraphicOutput.write(getData());
}

function setOutputFlags(flags) {
  outputFlags = { ...outputFlags, ...flags };
  if (flags.tcp === false) tcpServerOutput.stop();
  if (outputFlags.json) jsonFileOutput.write(getData());
  if (outputFlags.txt) {
    if (rawDataMode) {
      Object.entries(data).forEach(([k, v]) => txtFilesOutput.write(k, v));
    } else {
      const allowed = sportFields.getFieldsForSport(sportSettings.getCurrentSport());
      Object.entries(data).forEach(([k, v]) => {
        if (allowed && allowed.has(k)) txtFilesOutput.write(k, v);
      });
    }
  }
  if (outputFlags.tcp) {
    tcpServerOutput.start(config.hostedTcpPort);
    tcpServerOutput.broadcast(getData());
  }
  if (outputFlags.graphic) scoreGraphicOutput.write(getData());
}

function clear() {
  data = {};
}

function startTcpServerIfEnabled() {
  if (outputFlags.tcp) tcpServerOutput.start(config.hostedTcpPort);
}

function stopTcpServer() {
  tcpServerOutput.stop();
}

module.exports = {
  getData,
  update,
  setOutputFlags,
  setRawDataMode,
  getRawDataMode,
  clear,
  onSportChange,
  startTcpServerIfEnabled,
  stopTcpServer,
};
