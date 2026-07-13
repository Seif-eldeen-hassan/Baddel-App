'use strict';

const fs = require('fs/promises');
const path = require('path');

const {
    findMatchingEpicSwitcherProfile,
} = require('../../domain/services/epicSwitcherRules');

const REAL_EPIC_PROFILE_MARKERS = ['Data', 'Config', 'webcache', '_baddel_meta.json'];

function isRealEpicSwitcherProfile(folderEntryNames) {
    if (!Array.isArray(folderEntryNames)) return false;
    const lower = folderEntryNames.map(n => String(n).toLowerCase());
    return REAL_EPIC_PROFILE_MARKERS.some(m => lower.includes(m.toLowerCase()));
}

class EpicSwitcherRepository {
    constructor({ accountsRootDir, clock } = {}) {
        this.accountsRootDir = accountsRootDir;
        this.clock = clock || (() => new Date());
    }

    _platformDir(platform) {
        return path.join(this.accountsRootDir, platform);
    }

    _profileDir(platform, profileName) {
        return path.join(this._platformDir(platform), String(profileName || '').trim());
    }

    async findMatchingEpicProfile(accountId, displayName) {
        const epicDir = this._platformDir('epic');
        let entries;
        try { entries = await fs.readdir(epicDir, { withFileTypes: true }); } catch { return null; }

        const profiles = [];
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const profileDir = path.join(epicDir, entry.name);
            const isReal = isRealEpicSwitcherProfile(await fs.readdir(profileDir).catch(() => []));
            let syncLink = null;
            if (isReal) {
                try {
                    syncLink = JSON.parse(await fs.readFile(path.join(profileDir, 'sync_link.json'), 'utf8'));
                } catch { /* missing or corrupt sync_link */ }
            }
            profiles.push({ name: entry.name, isReal, syncLink });
        }

        return findMatchingEpicSwitcherProfile(accountId, displayName, profiles);
    }

    async writeSyncLinkToExistingProfile(platform, profileName, platformAccountId, extra = {}) {
        const switcherDir = this._profileDir(platform, profileName);
        try {
            try { await fs.access(switcherDir); } catch {
                return { ok: false, reason: 'missing_profile' };
            }

            if (platform === 'epic') {
                const entries = await fs.readdir(switcherDir).catch(() => []);
                if (!isRealEpicSwitcherProfile(entries)) {
                    return { ok: false, reason: 'phantom_profile' };
                }
            }

            const linkFile = path.join(switcherDir, 'sync_link.json');
            await fs.writeFile(linkFile, JSON.stringify({
                platformAccountId: String(platformAccountId),
                linkedAt: this.clock().toISOString(),
                ...extra
            }, null, 2), 'utf8');
            return { ok: true };
        } catch (error) {
            return { ok: false, reason: 'error', error };
        }
    }
}

module.exports = {
    EpicSwitcherRepository,
};
