'use strict';

function toBytes(value, unit) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return null;
    const normalized = String(unit || '').toLowerCase();
    if (normalized.startsWith('k')) return Math.round(amount * 1024);
    if (normalized.startsWith('m')) return Math.round(amount * 1024 ** 2);
    if (normalized.startsWith('g')) return Math.round(amount * 1024 ** 3);
    if (normalized.startsWith('t')) return Math.round(amount * 1024 ** 4);
    return Math.round(amount);
}

function parseClock(value) {
    const parts = String(value || '').split(':').map(Number);
    if (!parts.length || parts.some(part => !Number.isFinite(part))) return null;
    return parts.reduce((seconds, part) => seconds * 60 + part, 0);
}

function phaseFor(text) {
    const message = text.replace(/^\[[^\]]+\]\s+(?:INFO|WARNING):\s*/i, '').replace(/^[=+-]\s*/, '');
    // Transfer counters describe concurrent work, not installation lifecycle.
    if (/^(?:Progress\s*:|Downloaded\s*:|Written\s*:|Download\s*-|Disk\s*-|Download size\s*:|Install size\s*:)/i.test(message)) return 'downloading';
    if (/^(?:Verifying files|Checking files)\b/i.test(message)) return 'verifying';
    if (/^(?:Installing|Running) prerequisites\b/i.test(message)) return 'prerequisites';
    if (/^Installing (?:game|files)\b/i.test(message)) return 'installing';
    if (/^(?:Finalizing|Finishing) installation\b/i.test(message)) return 'finalizing';
    if (/^Downloading\b/i.test(message)) return 'downloading';
    return 'preparing';
}

function parseLegendaryProgressLine(line) {
    const text = String(line || '').trim();
    if (!text || /^\[[^\]]+\]\s+DEBUG:/i.test(text) || /^(?:\[[^\]]+\]\s+INFO:\s*)?Starting .*worker\b/i.test(text)) return null;
    const percent = text.match(/(?:progress|verifying files)\s*:\s*(\d+(?:\.\d+)?)\s*%/i);
    const bytes = text.match(/(\d+(?:\.\d+)?)\s*(KiB|MiB|GiB|TiB|KB|MB|GB|TB)\s*\/\s*(\d+(?:\.\d+)?)\s*(KiB|MiB|GiB|TiB|KB|MB|GB|TB)/i);
    const rawSpeed = text.match(/download\s*-\s*(\d+(?:\.\d+)?)\s*(KiB|MiB|GiB|KB|MB|GB)\/s\s*\(raw\)/i);
    const downloaded = text.match(/Downloaded:\s*(\d+(?:\.\d+)?)\s*(KiB|MiB|GiB|TiB|KB|MB|GB|TB|B)\b/i);
    const written = text.match(/Written:\s*(\d+(?:\.\d+)?)\s*(KiB|MiB|GiB|TiB|KB|MB|GB|TB|B)\b/i);
    const downloadSize = text.match(/Download size:\s*(\d+(?:\.\d+)?)\s*(KiB|MiB|GiB|TiB|KB|MB|GB|TB|B)\b/i);
    const diskWrite = text.match(/disk\s*-\s*(\d+(?:\.\d+)?)\s*(KiB|MiB|GiB|KB|MB|GB)\/s\s*\(write\)/i);
    const eta = text.match(/ETA\s*:\s*([0-9:]+)/i);
    const stage = phaseFor(text);
    if (!percent && !bytes && !downloaded && !written && !downloadSize && !rawSpeed && !diskWrite && stage === 'preparing') return null;
    return {
        stage,
        status: stage === 'verifying' ? 'verifying' : (stage === 'installing' || stage === 'prerequisites' || stage === 'finalizing' ? 'installing' : 'downloading'),
        progressPercent: percent ? Math.max(0, Math.min(100, Number(percent[1]))) : null,
        downloadedBytes: downloaded ? toBytes(downloaded[1], downloaded[2]) : bytes ? toBytes(bytes[1], bytes[2]) : null,
        writtenBytes: written ? toBytes(written[1], written[2]) : null,
        totalBytes: downloadSize ? toBytes(downloadSize[1], downloadSize[2]) : bytes ? toBytes(bytes[3], bytes[4]) : null,
        downloadSpeedBps: rawSpeed ? toBytes(rawSpeed[1], rawSpeed[2]) : null,
        diskUsageBps: diskWrite ? toBytes(diskWrite[1], diskWrite[2]) : null,
        etaSeconds: eta ? parseClock(eta[1]) : null,
        statusMessage: stage === 'verifying' ? 'Verifying files' : stage === 'installing' ? 'Writing game files' : stage === 'prerequisites' ? 'Installing prerequisites' : stage === 'finalizing' ? 'Finalizing installation' : 'Downloading compressed data',
    };
}

class EpicLegendaryProgressParser {
    constructor({ onLine = null } = {}) { this.buffer = ''; this.onLine = onLine; }
    parseLine(line) {
        const event = parseLegendaryProgressLine(line);
        try { this.onLine?.(line, event); } catch {}
        return event;
    }
    push(chunk) {
        this.buffer += String(chunk || '').replace(/\r/g, '\n');
        const lines = this.buffer.split('\n');
        this.buffer = (lines.pop() || '').slice(-16384);
        return lines.map(line => this.parseLine(line)).filter(Boolean);
    }
    flush() {
        const event = this.parseLine(this.buffer);
        this.buffer = '';
        return event ? [event] : [];
    }
}

module.exports = { EpicLegendaryProgressParser, parseLegendaryProgressLine, toBytes };
