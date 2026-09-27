'use strict';

function normalizeAccountSaveName(value) {
    const raw = value && typeof value === 'object' && !Array.isArray(value)
        ? value.accountName
        : value;
    const accountName = String(raw ?? '').trim();
    if (!accountName) {
        const error = new Error('Account name is required.');
        error.code = 'ACCOUNT_NAME_REQUIRED';
        throw error;
    }
    return accountName;
}

function createAccountSaveHandler(saveCurrent) {
    if (typeof saveCurrent !== 'function') throw new TypeError('saveCurrent must be a function.');
    return async (_event, payload) => saveCurrent(normalizeAccountSaveName(payload));
}

module.exports = { normalizeAccountSaveName, createAccountSaveHandler };
