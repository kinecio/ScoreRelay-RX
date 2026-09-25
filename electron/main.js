/**
 * ScoreRelay-RX desktop shell.
 *
 * Runs the same server the command-line build runs (src/server.js), inside the
 * app, and shows its web UI in a window. Nothing about the server changes; the
 * shell only (a) gives it a per-user folder for saved settings, (b) points a
 * window at it, and (c) makes sure a live connection is not dropped by
 * accident.
 *
 * On macOS this is also what lets Bluetooth work: the system only grants
 * Bluetooth to an app bundle that declares it (see the build config), not to a
 * bare command-line binary.
 */

'use strict';

const { app, BrowserWindow, dialog, shell } = require('electron');

let win = null;
let port = 0;
let quitConfirmed = false;

if (!app.requestSingleInstanceLock()) {
  // A second copy would fight the first for the same devices and ports.
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    // Everything the server saves (settings, graphics, outputs) is written
    // relative to the working directory; make that a folder that is always
    // writable and belongs to this user.
    process.chdir(app.getPath('userData'));
    const { ready } = require('../src/server');
    port = await ready;
    createWindow();
  });

  app.on('activate', () => {
    if (port && BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Windows/Linux: closing the window ends the app. macOS keeps it running, as
  // Mac apps do, until it is quit explicitly.
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  // Never end a live connection silently: a broadcast may depend on it.
  app.on('before-quit', (event) => {
    if (quitConfirmed) return;
    const engine = require('../src/connectionEngine');
    if (!engine.isConnected()) return;
    event.preventDefault();
    const choice = dialog.showMessageBoxSync(win || undefined, {
      type: 'warning',
      buttons: ['Keep running', 'Quit'],
      defaultId: 0,
      cancelId: 0,
      title: 'ScoreRelay-RX',
      message: 'A device is still connected.',
      detail: 'Quitting will stop its data and any outputs that depend on it.',
    });
    if (choice === 1) {
      quitConfirmed = true;
      app.quit();
    }
  });
}

// Only web links ever leave the app; never a file:, custom-protocol or other
// scheme the page might try to hand to the operating system.
function openExternal(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' || u.protocol === 'http:') shell.openExternal(u.toString());
  } catch (_) {
    // not a URL: ignore
  }
}

function isOwnUrl(url) {
  try {
    const u = new URL(url);
    return (u.hostname === 'localhost' || u.hostname === '127.0.0.1') && Number(u.port) === port;
  } catch (_) {
    return false;
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 850,
    minWidth: 720,
    minHeight: 560,
    title: 'ScoreRelay-RX',
    webPreferences: {
      // The page is a plain web page served by our own server. It gets no
      // access to Node or to the machine beyond what that server exposes.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.on('closed', () => { win = null; });

  // Pages of this app open in app windows; anything else opens in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isOwnUrl(url)) return { action: 'allow' };
    openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!isOwnUrl(url)) {
      event.preventDefault();
      openExternal(url);
    }
  });

  win.loadURL('http://localhost:' + port);
}
