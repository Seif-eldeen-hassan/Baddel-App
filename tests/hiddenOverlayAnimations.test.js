'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DASHBOARD_CSS = fs.readFileSync(path.join(ROOT, 'src', 'css', 'dashboard.css'), 'utf8');
const ACCOUNTS_CSS = fs.readFileSync(path.join(ROOT, 'src', 'css', 'accounts.css'), 'utf8');

test('startup splash animations only run while the loader is active', () => {
    assert.match(DASHBOARD_CSS, /\.splash-logo-wrap\s*\{[\s\S]*?animation:\s*none;/);
    assert.match(DASHBOARD_CSS, /\.splash-progress-bar\s*\{[\s\S]*?animation:\s*none;/);
    assert.match(DASHBOARD_CSS, /\.loader-container\.active \.splash-logo-wrap[\s\S]*?animation:\s*splashLogoBreathe/);
    assert.match(DASHBOARD_CSS, /\.loader-container\.active \.splash-progress-bar[\s\S]*?animation:\s*splashProgressSweep/);
});

test('launch overlay animations only run while launch overlay is active', () => {
    assert.match(DASHBOARD_CSS, /\.pulse-dot\s*\{[^}]*animation:\s*none;/);
    assert.match(DASHBOARD_CSS, /\.aaa-progress-fill\s*\{[\s\S]*?animation:\s*none;/);
    assert.match(DASHBOARD_CSS, /\.aaa-progress-glow\s*\{[\s\S]*?animation:\s*none;/);
    assert.match(DASHBOARD_CSS, /\.launch-overlay\.active \.pulse-dot\s*\{[^}]*animation:\s*pulseDot/);
    assert.match(DASHBOARD_CSS, /\.launch-overlay\.active \.aaa-progress-fill\s*\{[^}]*animation:\s*scanline/);
    assert.match(DASHBOARD_CSS, /\.launch-overlay\.active \.aaa-progress-glow\s*\{[^}]*animation:\s*pulseGlow/);
});

test('platform sync spinner is paused until its overlay is visible', () => {
    assert.match(ACCOUNTS_CSS, /\.platform-sync-simple-spinner\s*\{[^}]*animation-play-state:\s*paused;/);
    assert.match(ACCOUNTS_CSS, /\.platform-sync-simple-overlay\.visible \.platform-sync-simple-spinner\s*\{[^}]*animation-play-state:\s*running;/);
});
