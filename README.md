# ScoreRelay-RX

ScoreRelay-RX is the open-source companion app for **ScoreRelay** — a scoreboard data
relay that decodes live scoreboard controller traffic and republishes game state.
ScoreRelay-RX connects to ScoreRelay devices to receive scoreboard data, then outputs
it as a combined JSON file, individual TXT files, and/or a hosted TCP server. A web
interface lets you change settings, enter credentials, and monitor the connection.

## Features

- **Cloud (ScoreRelay portal)** – Connect through the ScoreRelay cloud using a single
  access token you copy from your ScoreRelay cloud portal (Live Data tab) — never a
  device password. The endpoint is **fixed and not configurable in the UI** —
  you can't accidentally point the app somewhere else. Cloud connectivity is rolling
  out; if your account doesn't have it yet, use Local device mode instead.
- **Local device (TLS TCP)** – Connect straight to a ScoreRelay device on your network
  via its TLS TCP feed (port 1010 by default) using the device's API token (shown once
  under **Security** on the device's settings page). Self-signed certificate is expected;
  the API token is the credential.
- **USB device** – Connect a ScoreRelay device with a USB cable, even when it has no
  Wi-Fi or network at all. The app opens and holds the port itself, so the connection
  runs without a browser window. See "USB device mode" below.
- **Bluetooth device** – Connect to a ScoreRelay device wirelessly, with no cable and no
  network. Receive its live data into the same outputs, and manage it from the app
  (Wi-Fi, scoreboard controller, connection test, password, restart). The app holds the
  connection itself, so it keeps running without a browser window. See "Bluetooth device
  mode" below.
- **Sport-specific data** – The app reads the device's settings (e.g.
  `{"manufacturer":"daktronics","model":"5000","sport":"basketball","input_type":"cl"}`)
  and stores/writes only that sport's fields. Non-matching TXT files are removed when the
  sport changes. Supported sports: baseball, basketball, football, soccer, volleyball.
  The field list for each sport is in `src/sportFields.js`.
- **Outputs** (select any combination):
  - **JSON file** – Only the current sport's fields, plus a top-level `sport` field.
  - **Individual TXT files** – One `.txt` file per data field for the current sport only.
  - **Host TCP server** – The app sends the current sport's data as JSON (one object per
    line), including a `sport` field, to connected clients.
- **Web UI** – Settings (connection mode, credentials, output checkboxes),
  connect/disconnect, and a dashboard with connection status, message count, last
  activity, and live data preview.
- **Saved credentials** – Your cloud access token (or local device API token) is
  stored locally (`credentials.json`) so you don't have to re-enter it each time.
- **Port fallback** – The web server tries port 8080 first, then 8085, 8090, etc.
- **Update check** – The app checks a configurable GitHub repo for new releases.

## Prerequisites

- Node.js (LTS, e.g. 18 or 20)

## Install

```bash
npm install
```

## Configuration

Edit `src/config.js`:

- **Cloud endpoint** – `liveGateway.protocol`, `liveGateway.host`, `liveGateway.statePath`
  — the fixed ScoreRelay cloud endpoint. Do not expose these in the web UI (see
  guardrails below).
- **Local device** – `localDevice.port` (default 1010).
- **Web ports** – `webPorts` (list of ports to try for the web UI).
- **GitHub repo** – `githubRepo` (e.g. `owner/ScoreRelay-RX`) for update checks.
- **Output paths** – resolved at runtime to the user's Documents folder by default.

Tokens are not stored in config; use the web UI and "Save token" (or the API) so they
are written to `credentials.json` (gitignored).

## Run

```bash
npm start
```

Then open the URL printed in the terminal (e.g. `http://localhost:8080`).

## Cloud mode

Cloud mode streams live updates from the ScoreRelay cloud using the access token you
paste in — an opaque token, not a device password. Each update carries the device's
current sport and its data fields for that sport; the app stores and outputs only
those fields, the same as every other mode. Cloud connectivity is rolling out — if
your account doesn't have access yet, the app will simply fail to connect in this
mode; Local device mode is unaffected and always works.

## USB device mode

Use this when the device has no network connection of its own — connect it to this
computer with a USB cable.

1. Pick **USB device (this computer)** as the connection mode.
2. Choose the device's port (click **Refresh ports** if it isn't listed yet), then
   click **Connect**.

The app opens the port itself and keeps it open, reconnecting if the cable is
replugged — so this page does not need to stay open and the connection survives a
browser restart. Live data flows into your chosen outputs exactly like the other
modes.

If the device is set up to reach the ScoreRelay cloud over USB, RX carries that
connection as well; the device's traffic stays encrypted end to end.

USB mode uses the `serialport` package (installed by `npm install`) for the port.
No extra system drivers are needed on macOS, Linux, or Windows.

## Bluetooth device mode

Use this to connect to a device wirelessly — no cable, no network, and no need to be
on the same Wi-Fi.

1. Pick **Bluetooth device (this computer)** as the connection mode and click
   **Scan for devices**. Choose your device (they are named `ScoreRelay-` plus four
   characters).
2. Enter the device's **admin password** and click **Connect**.
3. **First time only — pair with the device.** Your computer must be paired with the
   device using its 6-digit passkey (printed on the device's label, and shown in your
   ScoreRelay portal). On **macOS** the system asks for it when you first connect. On
   **Windows**, pair the device in *Settings → Bluetooth & devices* first, then connect
   from the app. The app never sees or stores the passkey.

Once connected, live data flows into your chosen outputs (JSON, TXT files, TCP server,
graphics) exactly like the other modes, and a **Device** panel appears where you can:

- see the device's ID, firmware and Wi-Fi address
- scan for and join a Wi-Fi network
- run the network connection test
- view and change the scoreboard controller settings
- set a new admin password (required if the device still has its default one)
- restart the device

The app reconnects on its own if the link drops. Updates arrive about once a second.
Your admin password is kept in memory only for the length of the session; it is never
written to disk.

**Requirements and notes**

- macOS and Windows are supported. Linux is not supported yet.
- **macOS:** the first time, macOS asks whether to let the app that started
  ScoreRelay-RX (for example Terminal) use Bluetooth. If you decline, Bluetooth mode
  reports this and tells you where to turn it on (*System Settings → Privacy &
  Security → Bluetooth*); nothing else in the app is affected.
- Device controls in this mode only accept requests from the computer running the app,
  not from other machines on your network.
- Stay within a few metres of the device for a reliable link. Only one computer or phone
  can be connected to a device over Bluetooth at a time.
- Bluetooth mode uses the `@stoprocent/noble` package (installed by `npm install`).

### Cloud relay over Bluetooth

A device that has no Wi-Fi or Ethernet can still reach the ScoreRelay cloud through this
computer. In the **Device** panel, **Cloud relay** shows the state and lets you turn it on
(the device restarts). While it is on, this app carries the device's cloud connection over
Bluetooth: keep the app running and the computer within range. The connection stays encrypted
end to end between the device and the cloud, and this app never sees or stores any cloud
credentials. It needs a device that has been set up for the ScoreRelay cloud, and a device
that already has Wi-Fi or Ethernet will use this computer *instead* of its own network while
the relay is on.

## Desktop app (Windows and macOS)

Besides running from source or as a command-line binary, ScoreRelay-RX can be packaged as a
regular desktop application — a window instead of a browser tab, an installer for Windows and
a disk image for macOS.

```bash
npm install
npm run electron        # run the desktop app from source
npm run dist:mac        # macOS .dmg   (run on a Mac)
npm run dist:win        # Windows installer (run on Windows)
```

Output goes to `release/`. The desktop app uses a per-user folder for its saved settings and
graphics, and asks before quitting while a device is connected.

**Use the desktop app on macOS if you want Bluetooth.** macOS only grants Bluetooth to a real
app, not to a command-line binary; the desktop app declares it and macOS asks you once.

**Installing a downloaded build.** The builds on the Releases page are not signed with a
paid developer certificate, so your computer will warn you the first time.

- **macOS:** open the `.dmg` (Apple Silicon Macs use the `arm64` one, Intel Macs the other) and
  drag ScoreRelay-RX to Applications. The first time, right-click the app and choose **Open**
  (or allow it under System Settings → Privacy & Security). When macOS asks to allow Bluetooth,
  choose Allow, then **quit and reopen the app once** so the permission takes effect.
- **Windows:** run the setup `.exe`. If SmartScreen says it protected your PC, choose
  **More info → Run anyway**.

**Release builds.** `.github/workflows/desktop.yml` builds both installers on Windows and macOS
runners. Unsigned builds work but show a warning on first launch (Windows SmartScreen, macOS
Gatekeeper). For a production release, sign them: macOS needs a *Developer ID Application*
certificate plus notarization, Windows needs a code-signing certificate. Provide these as
repository secrets (names are listed at the top of the workflow); nothing is stored in the
repository. The app uses the default icon until you add your own at `build/icon.png`
(1024×1024) — electron-builder generates the platform icons from it.

## Local device (TLS TCP) protocol

The device's feed is one UTF-8 JSON object per line, terminated by `\r\n`. On connect:

1. TLS handshake (self-signed cert — the API token is the credential).
2. Client sends one auth line: `{"type":"auth","token":"..."}\r\n`.
3. Server replies `auth_ok` (or `auth_fail` and closes).
4. Then `state`/`heartbeat` lines arrive with the game state envelope
   (`{"v":1,"seq":42,"type":"state","sport":"basketball","fields":{...}}`).

## Security

- Cloud mode uses HTTPS. Do not commit `credentials.json`; it is gitignored.
- The web UI and API have no built-in auth; run on localhost or behind a reverse proxy
  if exposed. The Bluetooth device controls are the exception: they only accept requests
  from the local computer.

## Open-source guardrails

This repository is **public and open source** (AGPL-3.0). It documents nothing about the
internal security model, server topology, or infrastructure of the ScoreRelay service
beyond what an end user needs to connect their own device. Specifically:

- **Never commit secrets** — credentials, API tokens, passwords, or private keys.
- **Never document the service's security stack** — TLS internals, certificate
  management details, authentication mechanisms, or broker-side configuration.
- **Never mention internal hostnames/IPs/topology** beyond the one fixed public
  connection endpoint the app needs (the cloud endpoint).
- **Keep the cloud endpoint fixed** in `src/config.js` with no UI to change it — users
  should never be able to (or need to) point the app elsewhere.
- If a feature would require describing internals to work, prefer a user-facing
  description ("your device's API token from the Security page") over the mechanism.

Future contributors and AI agents working in this repo: see `AGENTS.md`.

## License

Copyright (C) 2026 Dommarsantiago

ScoreRelay-RX is free software, licensed under the **GNU Affero General Public License,
version 3** (AGPL-3.0-only). You may use, study, change and share it. If you distribute a
modified version, or let people use a modified version over a network, you must make the
corresponding source code available to them under the same license. The full text is in
[`LICENSE`](LICENSE); the source for every release is at
<https://github.com/kinecio/ScoreRelay-RX>.

Third-party components keep their own licenses; see `THIRD_PARTY_NOTICES.md`.
