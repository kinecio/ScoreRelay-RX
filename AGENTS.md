# AGENTS.md — ScoreRelay-RX

Guide for AI coding assistants and contributors working in this repository.

## What this repo is

**ScoreRelay-RX is the open-source companion app for ScoreRelay**, a separate,
closed-source project. This app receives scoreboard data from ScoreRelay devices —
either through the cloud (a single access token from the cloud portal, streamed over
HTTPS — never a raw device password) or directly on the local network (TLS TCP) —
and outputs it as JSON/TXT/hosted-TCP for overlays and automation.

## The most important rule: this repo is PUBLIC

ScoreRelay-RX is AGPL-3.0-licensed and public. **Anything you write here may be read by
anyone.** The parent project (ScoreRelay) has a private security model, server
infrastructure, and operational details that must never leak into this repo.

**Never commit or describe:**

- Secrets of any kind: passwords, API/access tokens, broker credentials, private keys, certs.
- The parent project's security stack: TLS/mTLS internals, certificate-generation
  mechanics, authentication/authorization implementation, broker-side ACLs or
  configuration, API-token formats.
- Internal infrastructure: server hostnames/IPs beyond the one fixed public
  connection endpoint, network topology, deployment details, ports of internal
  services, database/broker internals.
- Anything that would let a reader reproduce or weaken the parent project's
  security posture.

**Always keep the cloud endpoint fixed** (`src/config.js` → `liveGateway.host/
protocol/statePath`) and **never add a UI element to change it** — the whole point is
that users cannot accidentally (or deliberately) point the app somewhere else. A
public hostname that the app needs to function is fine; the mechanism behind it is
not.

When a feature needs connection details, describe them the way a user would use
them ("your device's API token from the device's Security page", "your access token
from the ScoreRelay cloud portal"), never the underlying protocol security design.

## Working here

- Node.js app: `src/server.js` (Express), `src/connectionEngine.js` (mode
  dispatch), `src/liveGatewayClient.js` (cloud, token-authenticated SSE stream),
  `src/tcpClient.js` (local TLS TCP + legacy plaintext), `public/` (web UI).
- Two primary connection modes:
  - **Cloud** (`mode: 'cloud'`) — fixed endpoint from `config.liveGateway`, a single
    access token from the user (no username/password).
  - **Local device** (`mode: 'local'`) — TLS TCP to a device on the LAN (default
    port 1010) with an API token.
  - Legacy plaintext TCP (`mode: 'tcp'`) exists for dev/testing; keep it out of the
    UI unless explicitly asked to add it.
- **Bluetooth device** (`mode: 'ble'`) — `src/bleLink.js` owns the session (sign-in,
  ~1 Hz state polling, whitelisted device management, auto-reconnect);
  `src/bleFrame.js` is the message framing; `src/bleTransport.js` + `src/bleWorker.js`
  run the radio (`@stoprocent/noble`) in a **separate helper process** on purpose —
  a missing macOS Bluetooth permission aborts the process that asked, and that must
  never be the server driving live outputs. Pairing is done by the operating system;
  RX never handles the passkey. The admin password is held in memory only, never
  written to disk. The `/api/ble/*` routes and BLE connects are loopback-only (the
  server listens on all interfaces). Keep comments, docs and UI text about it
  user-level: what the user does, never how the device secures itself.
- **Desktop app** — `electron/main.js` runs the same server in an Electron window
  (`npm run electron`, `npm run dist:mac|win`, `.github/workflows/desktop.yml`). It is
  what gives macOS Bluetooth permission (an app bundle with the usage text and the
  Bluetooth entitlement, see `build/entitlements.mac.plist` and the `build` block in
  `package.json`). The installer `files` list is a strict whitelist on purpose: keep it
  that way so saved credentials or local data can never be packaged. No certificates or
  passwords belong in this repo; signing runs from CI secrets.
- **Cloud relay** — `bleLink.js` can carry the device's cloud connection over Bluetooth
  when the device is set up for it (`usbTunnel.js` factory, one instance per carrier).
  It only passes bytes along, holds no cloud credentials, and must never reveal where it
  connects to (see the "never exposes" test).
- The token lives in `credentials.json` (gitignored) — never commit it.
- Keep changes minimal and consistent with the existing stdlib-first, dependency-
  light style.

## Release / publishing

- Run `npm run build` to produce standalone binaries (see `package.json`).
- Before any release: `git grep -iE "(secret|token|password|api[_-]?key|BEGIN .*PRIVATE)"`
  over the repo to confirm nothing sensitive slipped in.
