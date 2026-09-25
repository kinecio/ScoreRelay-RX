#!/usr/bin/env node
'use strict';
// Build a single pkg executable for the current platform using node18 (pkg does not ship node24+ binaries).
const { execSync } = require('child_process');
const path = require('path');

const platform = process.platform;
const arch = process.arch;

const targetMap = {
  darwin: { arm64: 'node18-macos-arm64', x64: 'node18-macos-x64' },
  win32: { x64: 'node18-win-x64', arm64: 'node18-win-arm64' },
  linux: { x64: 'node18-linux-x64', arm64: 'node18-linux-arm64' },
};

const targets = targetMap[platform];
const target = targets ? targets[arch] || targets.x64 : null;
if (!target) {
  console.error('Unsupported platform:', platform, arch);
  process.exit(1);
}

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'dist', 'ScoreRelay-RX');
const cmd = `npx pkg . --targets ${target} --output ${out}`;
console.log('Running:', cmd);
execSync(cmd, { cwd: root, stdio: 'inherit' });
