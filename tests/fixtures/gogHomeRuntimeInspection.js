'use strict';

const path = require('path');
const { app, BrowserWindow } = require('electron');

app.whenReady().then(async () => {
    const win = new BrowserWindow({
        width: 1200,
        height: 760,
        show: false,
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    await win.loadFile(path.join(__dirname, '..', '..', 'src', 'dashboard.html'));
    const result = await win.webContents.executeJavaScript(`(async () => {
        const initialGogCount = document.getElementById('gogCount')?.textContent;
        const libraries = {
            steam: [{ id: 'steam-10', appName: '10', title: 'Shared Runtime Game', canonicalGameId: 'runtime-shared', ownedByAccountIds: ['s1'] }],
            epic: [],
            gog: [
                { id: 'gog_100', productId: '100', title: 'Shared Runtime Game', canonicalGameId: 'runtime-shared', ownedByAccountIds: ['g1'] },
                { id: 'gog_200', productId: '200', title: 'GOG Runtime Candidate', canonicalGameId: 'runtime-gog', ownedByAccountIds: ['g1'] },
            ],
        };
        const accounts = { steam: [{ id: 's1' }], epic: [], gog: [{ id: 'g1', platformAccountId: 'gog-runtime-account' }] };
        window.electronAPI = {
            platformSyncGetCached: async platform => ({ games: libraries[platform] || [] }),
            platformSyncGetAccounts: async platform => ({ accounts: accounts[platform] || [] }),
            platformSyncGetState: async () => ({ state: { phase: 'complete' } }),
            getSteamAccounts: async () => [], getEpicProfiles: async () => [],
            getGogProfiles: async () => [{ id: 'g1' }],
        };
        window.allGamesData = [{
            id: 'installed-gog-runtime', canonicalGameId: 'installed-gog-canonical', name: 'Installed GOG Runtime',
            platform: 'gog', scannerPlatform: 'gog', path: 'C:/Games/GOG/runtime.exe', installVerified: true,
        }];
        await window._buildSyncedSuggestions();
        const gogItems = window._suggSelectForFilter('gog', 17);
        const recommended = window._suggSelectForFilter('all', 17);
        const gogPill = document.querySelector('.sugg-pill[data-filter="gog"]');
        window.setSyncedFilter('gog', gogPill);
        window.setRouletteMode('play');
        const playPool = window._buildPlayPool();
        await window.updateAllAccountCounts();
        return {
            initialGogCount,
            hydratedGogCount: document.getElementById('gogCount')?.textContent,
            gogFilterVisible: !!gogPill && getComputedStyle(gogPill).display !== 'none',
            gogFilterActive: gogPill?.classList.contains('active') === true,
            gogCandidates: gogItems.map(game => ({ id: game.id, accountIds: game.ownedByAccountIds, productId: game.productId })),
            recommendedPlatforms: recommended.map(game => game._platform),
            recommendedCanonicalIds: recommended.map(game => game._canonicalKey),
            installedSpinIds: playPool.map(game => game.id),
            spinEnabled: document.getElementById('spinBtn')?.disabled === false,
        };
    })()`);
    const required = result.initialGogCount === '—' && result.hydratedGogCount === '1' && result.gogFilterVisible &&
        result.gogFilterActive && result.gogCandidates.some(game => game.id === 'gog_200' && game.accountIds.includes('g1')) &&
        result.recommendedPlatforms.includes('gog') && new Set(result.recommendedCanonicalIds).size === result.recommendedCanonicalIds.length &&
        result.installedSpinIds.includes('installed-gog-runtime') && result.spinEnabled;
    process.stdout.write(JSON.stringify(result));
    win.destroy();
    app.quit();
    if (!required) process.exitCode = 1;
}).catch(error => {
    process.stderr.write(error.stack || error.message);
    app.exit(1);
});
