'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EpicLegendaryProgressParser, parseLegendaryProgressLine } = require('../src/features/downloads/infrastructure/providers/epic/EpicLegendaryProgressParser');

test('Legendary parser reads representative progress, bytes, speed, disk, and ETA output', () => {
    const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/legendary/progress.txt'), 'utf8');
    const events = new EpicLegendaryProgressParser().push(fixture);
    const progress = events.find(event => event.progressPercent === 42.5);
    const telemetry = events.find(event => event.diskUsageBps > 0);
    assert.equal(progress.downloadedBytes, Math.round(1.25 * 1024 ** 3));
    assert.equal(progress.totalBytes, Math.round(2.94 * 1024 ** 3));
    assert.equal(progress.etaSeconds, 95);
    assert.equal(telemetry.downloadSpeedBps, Math.round(12.5 * 1024 ** 2));
    assert.equal(telemetry.diskUsageBps, Math.round(31.25 * 1024 ** 2));
});

test('Legendary parser distinguishes verification, prerequisites, and finalization', () => {
    assert.equal(parseLegendaryProgressLine('Verifying files: 98.00%').stage, 'verifying');
    assert.equal(parseLegendaryProgressLine('Installing prerequisites').stage, 'prerequisites');
    assert.equal(parseLegendaryProgressLine('Finalizing installation').stage, 'finalizing');
});
