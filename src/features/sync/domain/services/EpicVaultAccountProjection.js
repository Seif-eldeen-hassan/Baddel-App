'use strict';

function projectEpicVaultAccount(existingVault, authoritativeFields) {
    const existing = existingVault && typeof existingVault === 'object' ? existingVault : {};
    const authoritative = authoritativeFields && typeof authoritativeFields === 'object' ? authoritativeFields : {};
    return { ...existing, ...authoritative };
}

module.exports = { projectEpicVaultAccount };
