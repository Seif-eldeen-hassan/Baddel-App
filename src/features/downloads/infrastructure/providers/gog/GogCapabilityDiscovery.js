'use strict';

const REQUIRED_COMMANDS = Object.freeze(['download', 'info']);

class GogCapabilityDiscovery {
    constructor({ runtime, timeoutMs = 5000 } = {}) {
        if (!runtime) throw new Error('GogCapabilityDiscovery requires runtime');
        this.runtime = runtime;
        this.timeoutMs = timeoutMs;
        this.cached = null;
    }

    async discover({ force = false, env = {} } = {}) {
        if (this.cached && !force) return { ...this.cached };

        const verified = await this.runtime.verify({ timeoutMs: this.timeoutMs, env });
        const rootHelp = await this.runtime.run(['--help'], { timeoutMs: this.timeoutMs, env });
        const downloadHelp = await this.runtime.run(['download', '--help'], { timeoutMs: this.timeoutMs, env });
        const infoHelp = await this.runtime.run(['info', '--help'], { timeoutMs: this.timeoutMs, env });
        const rootText = `${rootHelp.stdout || ''}\n${rootHelp.stderr || ''}`;
        const downloadText = `${downloadHelp.stdout || ''}\n${downloadHelp.stderr || ''}`;
        const infoText = `${infoHelp.stdout || ''}\n${infoHelp.stderr || ''}`;
        const commands = extractCommands(rootText);
        const missing = REQUIRED_COMMANDS.filter(cmd => !commands.includes(cmd));
        const supportsDownload = missing.length === 0 && /--path\b/.test(downloadText);
        if (!supportsDownload) {
            const err = new Error(`Bundled GOG runtime does not support required download commands: ${missing.join(', ') || '--path'}`);
            err.code = 'GOG_RUNTIME_UNSUPPORTED';
            throw err;
        }

        this.cached = {
            provider: 'gog',
            available: true,
            runtimeVersion: verified.version,
            commands,
            supportsDownload,
            supportsInfo: commands.includes('info'),
            supportsResume: true,
            progressOutput: 'stdout-or-stderr',
            requiredDownloadArgs: ['--auth-config-path', 'download', '--path', 'id'],
            flags: {
                path: /--path\b/.test(downloadText),
                platform: /--platform\b|--os\b/.test(downloadText),
                lang: /--lang\b/.test(downloadText),
                skipDlcs: /--skip-dlcs\b/.test(downloadText),
                maxWorkers: /--max-workers\b/.test(downloadText),
                forceGen: /--force-gen\b/.test(downloadText) && /--force-gen\b/.test(infoText),
            },
            reason: null,
        };
        return { ...this.cached };
    }

    async getStatus({ env = {} } = {}) {
        try {
            return await this.discover({ env });
        } catch (err) {
            return {
                provider: 'gog',
                available: false,
                runtimeVersion: null,
                supportsDownload: false,
                supportsResume: false,
                reason: err?.code || 'GOG_RUNTIME_UNAVAILABLE',
            };
        }
    }
}

function extractCommands(helpText) {
    const text = String(helpText || '');
    const commandBlock = text.match(/\{([^}]+)\}/)?.[1] || '';
    return commandBlock
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);
}

module.exports = {
    GogCapabilityDiscovery,
    extractCommands,
};
