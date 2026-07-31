'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { GogProgressParser, stripAnsi, bytesFrom } = require('../src/features/downloads/infrastructure/providers/gog/GogProgressParser');

test('GOG progress parser handles lines, bytes, speed and eta', () => {
    const parser = new GogProgressParser();
    const events = parser.push(fs.readFileSync('tests/fixtures/gogdl/progress-active.txt', 'utf8'));
    const active = events.find(event => event.progressPercent === 12.5);
    assert.equal(active.stage, 'downloading');
    assert.equal(active.downloadedBytes, 128 * 1024 * 1024);
    assert.equal(active.totalBytes, 1024 * 1024 * 1024);
    assert.equal(active.etaSeconds, 164);
    const speed = events.find(event => event.eventType === 'download-speed');
    assert.equal(speed.rawDownloadSpeedBps, Math.round(5.5 * 1024 * 1024));
});

test('GOG progress parser keeps heroic-gogdl counters separate from game progress', () => {
    const parser = new GogProgressParser();
    const events = parser.push(fs.readFileSync('tests/fixtures/gogdl/heroic-progress-block.txt', 'utf8'));
    const overall = events.find(event => event.eventType === 'overall-progress');
    const counters = events.find(event => event.eventType === 'transfer-counters');
    const downloadSpeed = events.find(event => event.eventType === 'download-speed');
    const diskSpeed = events.find(event => event.eventType === 'disk-speed');

    assert.equal(overall.authoritativeTransfer, true);
    assert.equal(Math.round(overall.progressPercent * 10) / 10, 21.1);
    assert.equal(overall.downloadedBytes, 69206016);
    assert.equal(overall.writtenBytes, 69206016);
    assert.equal(overall.totalBytes, 327962160);
    assert.equal(overall.progressSource, 'gogdl-overall-progress');
    assert.equal(overall.etaSeconds, 75);

    assert.equal(counters.authoritativeTransfer, false);
    assert.equal(counters.rawDownloadedBytes, 64 * 1024 * 1024);
    assert.equal(counters.writtenBytes, 66 * 1024 * 1024);
    assert.equal(counters.downloadedBytes, undefined);
    assert.equal(counters.totalBytes, undefined);
    assert.equal(counters.progressPercent, undefined);

    assert.equal(downloadSpeed.rawDownloadSpeedBps, Math.round(3.30 * 1024 * 1024));
    assert.equal(downloadSpeed.decompressionSpeedBps, Math.round(4.10 * 1024 * 1024));
    assert.equal(diskSpeed.diskWriteSpeedBps, Math.round(4.20 * 1024 * 1024));
    assert.equal(diskSpeed.diskReadSpeedBps, 0);
});

test('Downloaded/Written diagnostics alone never create an authoritative tuple', () => {
    const parser = new GogProgressParser();
    const [event] = parser.push('[PROGRESS INFO]: = Downloaded: 64.00 MiB, Written: 66.00 MiB\n');
    assert.equal(event.eventType, 'transfer-counters');
    assert.equal(event.authoritativeTransfer, false);
    assert.equal(event.rawDownloadedBytes, 64 * 1024 * 1024);
    assert.equal(event.writtenBytes, 66 * 1024 * 1024);
    assert.equal(event.downloadedBytes, undefined);
    assert.equal(event.totalBytes, undefined);
});

test('raw downloaded bytes may equal written bytes without confirming completion', () => {
    const parser = new GogProgressParser();
    const [event] = parser.push('[PROGRESS INFO]: = Downloaded: 66.00 MiB, Written: 66.00 MiB\n');
    assert.equal(event.eventType, 'transfer-counters');
    assert.equal(event.authoritativeTransfer, false);
    assert.equal(event.rawDownloadedBytes, event.writtenBytes);
    assert.equal(event.completed, undefined);
});

test('GOG progress parser handles split chunks and carriage-return updates', () => {
    const parser = new GogProgressParser();
    const one = parser.push('Downloading 1');
    const two = parser.push('0% 10 MB / 100 MB 2 MB/s ETA 00:45\rDownloading 25% 25 MB / 100 MB\n');
    assert.equal(one.length, 0);
    assert.equal(two.length, 2);
    assert.equal(two[0].progressPercent, 10);
    assert.equal(two[1].progressPercent, 25);
});

test('GOG progress parser handles native PROGRESS INFO current/total lines', () => {
    const parser = new GogProgressParser();
    const [event] = parser.push('[PROGRESS INFO]: Progress: 10.78 190816997/1769873846, Running for: 00:00:53, ETA: 00:07:19\n');
    assert.equal(event.stage, 'downloading');
    assert.equal(Math.round(event.progressPercent * 100) / 100, 10.78);
    assert.equal(event.downloadedBytes, 190816997);
    assert.equal(event.totalBytes, 1769873846);
    assert.equal(event.etaSeconds, 439);
    assert.equal(event.progressSource, 'gogdl-overall-progress');
});

test('GOG progress parser does not treat speed as total size', () => {
    const parser = new GogProgressParser();
    const [event] = parser.push('Downloading 1.3% 13 MB / 420 KB/s ETA 00:07:19\n');
    assert.equal(event.progressPercent, 1.3);
    assert.equal(event.downloadedBytes, undefined);
    assert.equal(event.totalBytes, undefined);
    assert.equal(event.downloadSpeedBps, 420 * 1000);
});

test('GOG progress parser strips ANSI and normalizes common error lines', () => {
    assert.equal(stripAnsi('\u001b[31mError\u001b[0m'), 'Error');
    assert.equal(bytesFrom('1.5', 'GB'), 1500000000);
    const parser = new GogProgressParser();
    const [event] = parser.push('\u001b[31mNot authenticated with GOG\u001b[0m\n');
    assert.equal(event.errorCode, 'GOG_AUTH_REQUIRED');
});
