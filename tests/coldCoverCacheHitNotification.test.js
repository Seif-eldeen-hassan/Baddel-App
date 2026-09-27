'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ColdCoverBootstrapService } = require('../src/features/games/infrastructure/services/ColdCoverBootstrapService');

test('cached boosts notify a fresh renderer in a batch without downloads, including already-ready jobs', async () => {
    const notifications = [];
    let downloads = 0;
    const service = new ColdCoverBootstrapService({
        artworkDownloadManager: {
            getCachedAsset: () => ({ fileUrl: 'file:///cache/cover.webp' }),
            requestAsset: async () => { downloads++; },
        },
        notify: payload => notifications.push(payload),
    });
    const games = [{ id: 'epic_one', platform: 'epic' }, { id: 'steam_42', platform: 'steam' }];
    for (let attempt = 0; attempt < 2; attempt++) {
        games.forEach(game => service.boost([game], { priority: 'visible' }));
        await new Promise(resolve => setTimeout(resolve, 300));
        assert.equal(notifications.length, attempt + 1);
        assert.equal(notifications[attempt].changedCanonicalIds.length, 2);
    }
    assert.equal(downloads, 0);
});
