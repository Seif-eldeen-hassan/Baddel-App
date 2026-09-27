'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { redactDiagnosticValue } = require('./DownloadDiagnosticRecorder');


function hashIdentity(value) {
    const text = String(value || '');
    return text ? `sha256:${crypto.createHash('sha256').update(text).digest('hex').slice(0, 12)}` : null;
}

function sanitizeInstallPlanDiagnostic(value, key = '') {
    const redacted = redactDiagnosticValue(value);
    if (redacted == null) return redacted;
    if (typeof redacted === 'string') {
        if (/accountId$/i.test(key)) return hashIdentity(redacted);
        if (/(?:install|config|auth|support)?Path$/i.test(key)) {
            const root = path.parse(redacted).root;
            return root ? `${root}[redacted]` : '[redacted-path]';
        }
        if (key === 'selectionKey') {
            try {
                const parts = JSON.parse(redacted);
                if (Array.isArray(parts) && parts.length > 2) parts[2] = hashIdentity(parts[2]);
                return JSON.stringify(parts);
            } catch { return '[invalid-selection-key]'; }
        }
        return redacted;
    }
    if (Array.isArray(redacted)) return redacted.map(item => sanitizeInstallPlanDiagnostic(item, key));
    if (typeof redacted === 'object') {
        return Object.fromEntries(Object.entries(redacted).map(([childKey, child]) => [
            childKey,
            sanitizeInstallPlanDiagnostic(child, childKey),
        ]));
    }
    return redacted;
}

class InstallPlanDiagnosticRecorder {
    constructor({ userDataDir, env = process.env, fsModule = fs, pathModule = path, clock = Date } = {}) {
        if (!userDataDir) throw new Error('InstallPlanDiagnosticRecorder requires userDataDir');
        this.enabled = env.BADDEL_INSTALL_PLAN_DEBUG === '1';
        this.fs = fsModule;
        this.path = pathModule;
        this.clock = clock;
        this.file = this.path.join(userDataDir, 'download-diagnostics', 'install-plan', 'latest-session.json');
        this.events = [];
        this.writeQueue = Promise.resolve();
        if (this.enabled) this.flush();
    }

    record(correlationId, stage, payload = {}) {
        if (!this.enabled || !correlationId || !stage) return;
        this.events.push(sanitizeInstallPlanDiagnostic({
            timestamp: new this.clock().toISOString(),
            correlationId: String(correlationId),
            stage: String(stage),
            ...payload,
        }));
        if (this.events.length > 500) this.events.splice(0, this.events.length - 500);
        this.flush();
    }

    flush() {
        if (!this.enabled) return Promise.resolve(null);
        const snapshot = JSON.stringify({ version: 1, events: this.events }, null, 2) + '\n';
        const write = async () => {
            await this.fs.promises.mkdir(this.path.dirname(this.file), { recursive: true });
            const temporary = `${this.file}.${process.pid}.tmp`;
            await this.fs.promises.writeFile(temporary, snapshot, 'utf8');
            await this.fs.promises.rename(temporary, this.file);
            return this.file;
        };
        this.writeQueue = this.writeQueue.then(write, write);
        return this.writeQueue;
    }
}

module.exports = { InstallPlanDiagnosticRecorder, sanitizeInstallPlanDiagnostic, hashIdentity };
