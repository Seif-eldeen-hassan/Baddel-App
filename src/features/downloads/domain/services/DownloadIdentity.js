'use strict';

const crypto = require('crypto');
const path = require('path');
const { normalizePlatform } = require('../entities/DownloadTask');

function slugFolderName(title) {
    const cleaned = String(title || 'Game')
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return cleaned || 'Game';
}

function buildDownloadIdentity(payload = {}) {
    const platform = normalizePlatform(payload.platform);
    const accountId = String(payload.accountId || '').trim();
    const providerId = String(
        payload.providerAppName ||
        payload.providerProductId ||
        payload.canonicalGameId ||
        payload.gameId ||
        ''
    ).trim().toLowerCase();
    const installPath = payload.installPath
        ? path.normalize(String(payload.installPath)).toLowerCase()
        : '';

    if (!platform || !accountId || !providerId) return null;
    const accountScope = String(payload.installProvider || '').toLowerCase() === 'legendary' ? 'shared-install' : accountId;
    return `${platform}:${accountScope}:${providerId}:${installPath}`;
}

function makeDownloadTaskId(identityKey) {
    return `dl_${crypto.createHash('sha1').update(String(identityKey || `${Date.now()}`)).digest('hex').slice(0, 16)}`;
}

module.exports = {
    buildDownloadIdentity,
    makeDownloadTaskId,
    slugFolderName,
};
