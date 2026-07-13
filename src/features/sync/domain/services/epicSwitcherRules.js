'use strict';

function normalizeEpicSwitcherMatchValue(value) {
    return String(value || '').toLowerCase().trim();
}

function findMatchingEpicSwitcherProfile(accountId, displayName, profiles) {
    const idStr = normalizeEpicSwitcherMatchValue(accountId);
    const nameStr = normalizeEpicSwitcherMatchValue(displayName);
    const list = Array.isArray(profiles) ? profiles : [];

    for (const profile of list) {
        if (!profile || !profile.isReal) continue;

        const profileName = String(profile.name || '');
        if (nameStr && normalizeEpicSwitcherMatchValue(profileName) === nameStr) {
            return profileName;
        }

        const syncLink = profile.syncLink || {};
        if (idStr && normalizeEpicSwitcherMatchValue(syncLink.platformAccountId) === idStr) {
            return profileName;
        }
        if (nameStr && normalizeEpicSwitcherMatchValue(syncLink.epicDisplayName) === nameStr) {
            return profileName;
        }
    }

    return null;
}

module.exports = {
    findMatchingEpicSwitcherProfile,
    normalizeEpicSwitcherMatchValue,
};
