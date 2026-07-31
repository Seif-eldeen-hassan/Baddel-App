'use strict';

function parseSizeToBytes(value, unit) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const u = String(unit || '').toLowerCase();
    if (u.startsWith('kb')) return Math.round(n * 1024);
    if (u.startsWith('mb')) return Math.round(n * 1024 * 1024);
    if (u.startsWith('gb')) return Math.round(n * 1024 * 1024 * 1024);
    return Math.round(n);
}

class DownloadProgressParser {
    constructor() {
        this.buffer = '';
    }

    push(chunk) {
        this.buffer += String(chunk || '').replace(/\r/g, '\n');
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() || '';
        return lines.map(line => this.parseLine(line)).filter(Boolean);
    }

    flush() {
        const line = this.buffer;
        this.buffer = '';
        return line ? [this.parseLine(line)].filter(Boolean) : [];
    }

    parseLine(line) {
        const text = String(line || '').trim();
        if (!text) return null;
        const pct = text.match(/(\d+(?:\.\d+)?)\s*%/);
        const bytes = text.match(/(\d+(?:\.\d+)?)\s*(KB|MB|GB)\s*\/\s*(\d+(?:\.\d+)?)\s*(KB|MB|GB)/i);
        const speed = text.match(/(\d+(?:\.\d+)?)\s*(KB|MB|GB)\/s/i);
        const eta = text.match(/ETA\s*:?\s*(\d+):(\d+):(\d+)/i);
        return {
            stage: /verif/i.test(text) ? 'verifying' : /install/i.test(text) ? 'installing' : 'downloading',
            progressPercent: pct ? Math.max(0, Math.min(100, Number(pct[1]))) : null,
            downloadedBytes: bytes ? parseSizeToBytes(bytes[1], bytes[2]) : null,
            totalBytes: bytes ? parseSizeToBytes(bytes[3], bytes[4]) : null,
            speedBps: speed ? parseSizeToBytes(speed[1], speed[2]) : null,
            etaSeconds: eta ? (Number(eta[1]) * 3600 + Number(eta[2]) * 60 + Number(eta[3])) : null,
            message: text.replace(/token|authorization|cookie/ig, '[redacted]'),
        };
    }
}

module.exports = { DownloadProgressParser };
