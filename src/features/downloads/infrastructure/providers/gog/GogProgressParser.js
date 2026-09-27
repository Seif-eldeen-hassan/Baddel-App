'use strict';

const ANSI_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

class GogProgressParser {
    constructor() {
        this.buffer = '';
        this.lastPercent = null;
        this.lastAuthoritativeTransfer = null;
    }

    push(chunk) {
        const text = stripAnsi(String(chunk || '')).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        this.buffer += text;
        const parts = this.buffer.split('\n');
        this.buffer = parts.pop() || '';
        return parts.map(line => this.parseLine(line)).filter(Boolean);
    }

    flush() {
        if (!this.buffer) return [];
        const line = this.buffer;
        this.buffer = '';
        const parsed = this.parseLine(line);
        return parsed ? [parsed] : [];
    }

    parseLine(line) {
        const clean = stripAnsi(String(line || '')).trim();
        if (!clean) return null;
        const lower = clean.toLowerCase();

        const gogInfo = parseGogProgressInfo(clean);
        if (gogInfo) {
            const derivedPercent = gogInfo.totalBytes > 0
                ? Math.max(0, Math.min(100, (gogInfo.writtenBytes / gogInfo.totalBytes) * 100))
                : gogInfo.progressPercent;
            const progressPercent = derivedPercent;
            this.lastPercent = progressPercent;
            this.lastAuthoritativeTransfer = {
                writtenBytes: gogInfo.writtenBytes,
                downloadedBytes: gogInfo.writtenBytes,
                totalBytes: gogInfo.totalBytes,
                progressPercent,
                etaSeconds: gogInfo.etaSeconds,
            };
            return {
                eventType: 'overall-progress',
                authoritativeTransfer: true,
                stage: 'downloading',
                phase: 'downloading',
                message: clean.slice(0, 240),
                progressPercent,
                percentage: progressPercent,
                providerReportedPercent: gogInfo.progressPercent,
                writtenBytes: gogInfo.writtenBytes,
                downloadedBytes: gogInfo.writtenBytes,
                totalBytes: gogInfo.totalBytes,
                providerProgressMode: 'absolute',
                progressSource: 'gogdl-overall-progress',
                etaSeconds: gogInfo.etaSeconds,
                completed: progressPercent >= 100,
                errorCode: null,
            };
        }

        const counters = parseTransferCounters(clean);
        if (counters) {
            return {
                eventType: 'transfer-counters',
                authoritativeTransfer: false,
                stage: 'downloading',
                phase: 'downloading',
                message: clean.slice(0, 240),
                rawDownloadedBytes: counters.rawDownloadedBytes,
                writtenBytes: counters.writtenBytes,
                errorCode: null,
            };
        }

        const downloadSpeed = parseDownloadSpeed(clean);
        if (downloadSpeed) {
            return {
                eventType: 'download-speed',
                authoritativeTransfer: false,
                stage: 'downloading',
                phase: 'downloading',
                message: clean.slice(0, 240),
                rawDownloadSpeedBps: downloadSpeed.rawDownloadSpeedBps,
                decompressionSpeedBps: downloadSpeed.decompressionSpeedBps,
                downloadSpeedBps: downloadSpeed.rawDownloadSpeedBps,
                speedBytesPerSecond: downloadSpeed.rawDownloadSpeedBps,
                errorCode: null,
            };
        }

        const diskSpeed = parseDiskSpeed(clean);
        if (diskSpeed) {
            return {
                eventType: 'disk-speed',
                authoritativeTransfer: false,
                stage: 'downloading',
                phase: 'downloading',
                message: clean.slice(0, 240),
                diskWriteSpeedBps: diskSpeed.diskWriteSpeedBps,
                diskReadSpeedBps: diskSpeed.diskReadSpeedBps,
                diskUsageBps: diskSpeed.diskWriteSpeedBps,
                errorCode: null,
            };
        }

        const percentMatch = clean.match(/(\d+(?:\.\d+)?)\s*%/);
        let progressPercent = percentMatch ? Number(percentMatch[1]) : null;
        if (Number.isFinite(progressPercent)) {
            progressPercent = Math.max(0, Math.min(100, progressPercent));
            if (this.lastPercent !== null && progressPercent < this.lastPercent && !/\b(verif|install|repair|final)/i.test(clean)) {
                progressPercent = this.lastPercent;
            }
            this.lastPercent = progressPercent;
        }

        const speedMatch = clean.match(/(\d+(?:\.\d+)?)\s*(B|KiB|MiB|GiB|TiB|KB|MB|GB|TB)\/s/i);
        const etaSeconds = parseEta(clean);
        const phase = phaseFrom(lower);

        return {
            eventType: 'log',
            authoritativeTransfer: false,
            stage: phase,
            phase,
            message: clean.slice(0, 240),
            progressPercent,
            percentage: progressPercent,
            downloadSpeedBps: speedMatch ? bytesFrom(speedMatch[1], speedMatch[2]) : null,
            speedBytesPerSecond: speedMatch ? bytesFrom(speedMatch[1], speedMatch[2]) : null,
            etaSeconds,
            completed: /\b(done|complete|completed|finished|success)\b/i.test(clean),
            errorCode: errorCodeFrom(lower),
        };
    }
}

function stripAnsi(value) {
    return String(value || '').replace(ANSI_RE, '');
}

function bytesFrom(value, unit) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    const normalized = String(unit || '').toLowerCase();
    const factor = {
        b: 1,
        kb: 1000,
        mb: 1000 ** 2,
        gb: 1000 ** 3,
        tb: 1000 ** 4,
        kib: 1024,
        mib: 1024 ** 2,
        gib: 1024 ** 3,
        tib: 1024 ** 4,
    }[normalized] || 1;
    return Math.round(n * factor);
}

function parseEta(line) {
    const explicitHms = line.match(/\bETA[:=\s]+(\d{1,2}):(\d{2}):(\d{2})\b/i);
    if (explicitHms) return Number(explicitHms[1]) * 3600 + Number(explicitHms[2]) * 60 + Number(explicitHms[3]);
    const explicitMs = line.match(/\bETA[:=\s]+(\d{1,2}):(\d{2})\b/i);
    if (explicitMs) return Number(explicitMs[1]) * 60 + Number(explicitMs[2]);
    const explicit = line.match(/\bETA[:=\s]+(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?/i);
    if (explicit) {
        return (Number(explicit[1]) || 0) * 3600 + (Number(explicit[2]) || 0) * 60 + (Number(explicit[3]) || 0);
    }
    const hms = line.match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))\b/);
    if (!hms) return null;
    return hms[3]
        ? Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3])
        : Number(hms[1]) * 60 + Number(hms[2]);
}

function parseGogProgressInfo(line) {
    const match = String(line || '').match(/(?:\[PROGRESS INFO\]:\s*=\s*)?Progress:\s*(\d+(?:\.\d+)?)\s+(\d+)\/(\d+)(?:,\s*Running for:\s*(\d{1,2}):(\d{2}):(\d{2}))?(?:,\s*ETA:\s*(\d{1,2}):(\d{2}):(\d{2}))?/i);
    if (!match) return null;
    const progressPercent = Number(match[1]);
    const writtenBytes = Number(match[2]);
    const totalBytes = Number(match[3]);
    const etaSeconds = match[7] == null ? null : Number(match[7]) * 3600 + Number(match[8]) * 60 + Number(match[9]);
    return {
        progressPercent,
        writtenBytes,
        totalBytes,
        etaSeconds,
    };
}

function parseTransferCounters(line) {
    const match = String(line || '').match(/(?:\[PROGRESS INFO\]:\s*=\s*)?Downloaded:\s*(\d+(?:\.\d+)?)\s*(B|KiB|MiB|GiB|TiB|KB|MB|GB|TB),\s*Written:\s*(\d+(?:\.\d+)?)\s*(B|KiB|MiB|GiB|TiB|KB|MB|GB|TB)\b/i);
    if (!match) return null;
    return {
        rawDownloadedBytes: bytesFrom(match[1], match[2]),
        writtenBytes: bytesFrom(match[3], match[4]),
    };
}

function parseDownloadSpeed(line) {
    const match = String(line || '').match(/(?:\[PROGRESS INFO\]:\s*\+\s*)?Download\s*-\s*(\d+(?:\.\d+)?)\s*(B|KiB|MiB|GiB|TiB|KB|MB|GB|TB)\/s\s*\(raw\)\s*\/\s*(\d+(?:\.\d+)?)\s*(B|KiB|MiB|GiB|TiB|KB|MB|GB|TB)\/s\s*\(decompressed\)/i);
    if (!match) return null;
    return {
        rawDownloadSpeedBps: bytesFrom(match[1], match[2]),
        decompressionSpeedBps: bytesFrom(match[3], match[4]),
    };
}

function parseDiskSpeed(line) {
    const match = String(line || '').match(/(?:\[PROGRESS INFO\]:\s*\+\s*)?Disk\s*-\s*(\d+(?:\.\d+)?)\s*(B|KiB|MiB|GiB|TiB|KB|MB|GB|TB)\/s\s*\(write\)\s*\/\s*(\d+(?:\.\d+)?)\s*(B|KiB|MiB|GiB|TiB|KB|MB|GB|TB)\/s\s*\(read\)/i);
    if (!match) return null;
    return {
        diskWriteSpeedBps: bytesFrom(match[1], match[2]),
        diskReadSpeedBps: bytesFrom(match[3], match[4]),
    };
}

function phaseFrom(lower) {
    if (/verif|hash|repair|integrity/.test(lower)) return 'verifying';
    if (/unpack|decompress|writing|download|progress|chunk/.test(lower)) return 'downloading';
    if (/install|apply|finaliz/.test(lower)) return 'installing';
    if (/download|progress|chunk|manifest|file/.test(lower)) return 'downloading';
    if (/auth|login|token|license|owned/.test(lower)) return 'preparing';
    return null;
}

function errorCodeFrom(lower) {
    if (/not authenticated|unauthorized|forbidden|token|auth/.test(lower)) return 'GOG_AUTH_REQUIRED';
    const terminalLine = /\b(error|failed|fatal|exception|traceback|aborted)\b/.test(lower);
    if (!terminalLine) return null;
    if (/not owned|ownership|license/.test(lower)) return 'GOG_GAME_NOT_OWNED';
    if (/space|disk full|no space/.test(lower)) return 'GOG_INSUFFICIENT_DISK_SPACE';
    if (/network|timeout|connection|temporar/.test(lower)) return 'GOG_NETWORK_ERROR';
    return null;
}

module.exports = {
    GogProgressParser,
    stripAnsi,
    bytesFrom,
    parseGogProgressInfo,
    parseTransferCounters,
    parseDownloadSpeed,
    parseDiskSpeed,
};
