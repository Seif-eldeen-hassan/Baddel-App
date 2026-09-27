'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const vm = require('vm');
const VaultOverviewModel = require('../src/js/vault-overview-model');
const VaultHydrationClient = require('../src/js/vault-hydration-client');

const ROOT = path.resolve(__dirname, '..');
const sidebar = fs.readFileSync(path.join(ROOT, 'src/js/app/sidebar.js'), 'utf8');
const platformSync = fs.readFileSync(path.join(ROOT, 'platformSync.js'), 'utf8');
const platformSyncRepository = fs.readFileSync(path.join(ROOT, 'src/features/sync/infrastructure/repositories/PlatformSyncCacheRepository.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'src/css/dashboard.css'), 'utf8');
const dashboard = fs.readFileSync(path.join(ROOT, 'src/dashboard.html'), 'utf8');

function extractByName(source, name) {
    const patterns = [
        new RegExp(`function\\s+${name}\\s*\\(`),
        new RegExp(`async\\s+function\\s+${name}\\s*\\(`),
    ];
    const match = patterns.map((re) => re.exec(source)).find(Boolean);
    assert.ok(match, `${name} should exist`);
    const start = match.index;
    const paramsEnd = source.indexOf(') {', start);
    assert.notStrictEqual(paramsEnd, -1, `${name} should have body`);
    const bodyStart = source.indexOf('{', paramsEnd);
    let depth = 0;
    for (let i = bodyStart; i < source.length; i += 1) {
        if (source[i] === '{') depth += 1;
        if (source[i] === '}') depth -= 1;
        if (depth === 0) return source.slice(start, i + 1);
    }
    throw new Error(`Could not extract ${name}`);
}

test('Vault no longer hardcodes the first Epic account as the rendered account', () => {
    const hydrate = extractByName(sidebar, 'hydrateEpicVaultConsole');
    assert.doesNotMatch(hydrate, /accounts\s*\[\s*0\s*\]/);
    assert.match(sidebar, /__vaultSelectedEpicAccountId/);
});

test('Epic Vault renders a linked-account selection screen', () => {
    const fn = extractByName(sidebar, '_renderVaultEpicAccounts');
    assert.match(fn, /vault-epic-account-card/);
    assert.match(fn, /selectVaultEpicAccount/);
    assert.match(fn, /account\.accountId/);
});

test('Selecting Account B resolves Account B by accountId only', () => {
    const render = extractByName(sidebar, '_renderVaultEpicFromCache');
    assert.match(render, /accounts\.find\(\(item\) => String\(item\.accountId\) === String\(__vaultSelectedEpicAccountId\)\)/);
    assert.doesNotMatch(render, /paidItems|purchaseHistoryItems|livePrices/);
});

test('Verified zero Epic Store price renders FREE', () => {
    const fn = extractByName(sidebar, '_vaultGetCurrentPriceView');
    assert.match(fn, /status === 'free'/);
    assert.match(fn, /label: 'FREE'/);
});

test('Failed or unresolved current price never falls back to Free', () => {
    const fn = extractByName(sidebar, '_vaultGetCurrentPriceView');
    assert.match(fn, /label: 'Price unavailable'/);
    assert.doesNotMatch(fn, /\|\|\s*'Free'/i);
});

test('Missing live price does not become zero dollars', () => {
    const fn = extractByName(sidebar, '_vaultGetCurrentPriceView');
    assert.doesNotMatch(fn, /\$0|0\.00/);
    assert.match(fn, /priceResolved/);
});

test('Current Value sums only resolved priced values', () => {
    const fn = extractByName(sidebar, '_vaultEpicCoverage');
    assert.match(fn, /view\.status === 'priced'/);
    assert.match(fn, /currentValueMinor \+= Number\(game\.livePrice\?\.amount \|\| 0\)/);
});

test('Coverage tracks priced, free, unresolved, and total games', () => {
    const fn = extractByName(sidebar, '_vaultEpicCoverage');
    for (const token of ['totalGames', 'pricedGames', 'freeGames', 'unresolvedGames', 'resolvedGames']) {
        assert.match(fn, new RegExp(token));
    }
});

test('Purchase mode displays account purchase price from account-scoped purchase data', () => {
    const fn = extractByName(sidebar, '_vaultGetPurchasePriceView');
    assert.match(fn, /_vaultFindPurchaseForGame\(game, purchaseMap, \{ paidOnly: true \}\)/);
    assert.match(fn, /_vaultMinorMoney\(amountMinor/);
});

test('Purchase matching prefers namespace plus offerId over title fallback', () => {
    const fn = extractByName(sidebar, '_vaultIdentityKeys');
    assert.ok(fn.indexOf('ns:${namespace}:offer:${offerId}') < fn.indexOf('title:${title}'));
});

test('Switching price mode renders from cache and does not trigger sync or auth', () => {
    const fn = extractByName(sidebar, 'setVaultEpicPriceMode');
    assert.match(fn, /_renderVaultEpicFromCache/);
    assert.doesNotMatch(fn, /platformSyncSync|platformSyncLink|hydrateEpicVaultConsole|openEpicLoginWindow|runLegendary/);
});

test('Switching Vault tabs renders from cache and does not trigger sync or auth', () => {
    const fn = extractByName(sidebar, 'setVaultEpicSection');
    assert.match(fn, /_renderVaultEpicFromCache/);
    assert.doesNotMatch(fn, /platformSyncSync|platformSyncLink|hydrateEpicVaultConsole|openEpicLoginWindow|runLegendary/);
});

test('Purchase History renders completed paid order cards', () => {
    const row = extractByName(sidebar, '_vaultHistoryRowHtml');
    assert.match(row, /vault-history-row/);
    assert.match(row, /_vaultHistoryAmountLabel/);
    assert.match(row, /item\.status/);
});

test('Purchase History renders completed zero-value orders as FREE', () => {
    const fn = extractByName(sidebar, '_vaultHistoryAmountLabel');
    assert.match(fn, /amountMinor === 0/);
    assert.match(fn, /return 'FREE'/);
});

test('Purchase History renders refunds distinctly', () => {
    const row = extractByName(sidebar, '_vaultHistoryRowHtml');
    const labels = extractByName(sidebar, '_vaultHistoryTypeLabel');
    assert.match(row, /is-\$\{type\}/);
    assert.match(labels, /Refund/);
});

test('Purchase History renders Fab orders distinctly', () => {
    const row = extractByName(sidebar, '_vaultHistoryRowHtml');
    const labels = extractByName(sidebar, '_vaultHistoryTypeLabel');
    assert.match(row, /is-\$\{type\}/);
    assert.match(labels, /FAB/);
});

test('Empty successful history renders a valid empty state', () => {
    const fn = extractByName(sidebar, '_vaultEpicHistoryStatus');
    assert.match(fn, /No purchases found/);
    assert.match(fn, /successful purchase-history response/);
    assert.match(fn, /Purchase History not imported/);
    assert.match(fn, /Applying purchase history/);
    assert.match(fn, /pending.*running/);
    assert.doesNotMatch(fn, /Link your Epic|Connect Epic Purchase History/);
});

test('History belonging to Account A never appears under Account B', () => {
    const render = extractByName(sidebar, '_renderVaultEpicAccountDetail');
    assert.match(render, /_renderVaultEpicHistory\(account,/);
    assert.doesNotMatch(render, /__vaultEpicDataCache\.purchaseHistoryItems|accounts\.flatMap/);
});

test('Price-only and library-only sync preserve existing purchase history data', () => {
    const fn = extractByName(platformSync, 'mergeEpicVaultValuation');
    assert.match(fn, /existingVault\?\.purchaseHistoryItems/);
    assert.match(fn, /arrayOrExisting\('paidItems'\)/);
    assert.match(fn, /arrayOrExisting\('fabItems'\)/);
    assert.match(fn, /existingVault\?\.purchaseGames/);
});

test('Epic one-login regression still has auth code only in link path', () => {
    const syncSingle = extractByName(platformSync, 'syncSingleEpicAccount');
    assert.doesNotMatch(syncSingle, /openEpicLoginWindow\(/);
    assert.doesNotMatch(syncSingle, /runLegendary\(\['auth', '--code'/);
    const linkStart = platformSync.indexOf('async link(parentWindow');
    const linkEnd = platformSync.indexOf('async syncLibrary(targetAccountId = null, opts = {}, parentWindow = null, runtime = {})', linkStart);
    const linkBlock = platformSync.slice(linkStart, linkEnd);
    assert.match(linkBlock, /openEpicLoginWindow\(parentWindow, syncOptions\)/);
    assert.match(linkBlock, /runLegendary\(\['auth', '--code', authCode\]/);
});

test('Vault CSS uses All Games-like cover grid and cards without a tiny inner list scrollbar', () => {
    assert.match(css, /\.vault-epic-library-grid/);
    assert.match(css, /\.vault-epic-cover-card/);
    assert.match(sidebar, /game-card vault-epic-cover-card/);
    const newGrid = css.slice(css.indexOf('.vault-epic-library-grid'), css.indexOf('.vault-epic-cover-card'));
    assert.doesNotMatch(newGrid, /max-height\s*:\s*220px|overflow\s*:\s*auto/);
});

test('Steam and GOG flows are not referenced by the Epic Vault renderer', () => {
    const hydrate = extractByName(sidebar, 'hydrateEpicVaultConsole');
    assert.doesNotMatch(hydrate, /steam|gog|riot|downloads/i);
});

test('Order history persistence keeps safe transaction rows but not authentication secrets', () => {
    const normalizer = extractByName(platformSync, 'normalizeEpicPurchaseHistoryItems');
    assert.match(normalizer, /purchaseHistoryItems|orderId|amountMinor|currency|items/);
    assert.doesNotMatch(normalizer, /cookie|authorizationCode|access_token|refresh_token|sessionId/i);
    const processor = extractByName(platformSync, 'processEpicOrdersForVault');
    assert.match(processor, /purchaseHistoryItems: normalizeEpicPurchaseHistoryItems\(unique\)/);
});
test('Spend reconciliation defines auditable gross/refund/net fields', () => {
    const fn = extractByName(platformSync, 'processEpicOrdersForVault');
    for (const token of ['grossPurchasesMinor', 'refundsMinor', 'netSpentMinor', 'gameSpendMinor', 'fabSpendMinor', 'freeClaimsCount', 'cancelledOrdersCount', 'duplicateOrdersDropped']) {
        assert.match(fn, new RegExp(token));
    }
    assert.match(fn, /actualSpentMinor: net\.amountMinor/);
    assert.match(fn, /realSpent: net\.amountMinor \/ 100/);
});

test('Order history is deduplicated before spend is calculated', () => {
    const stable = extractByName(platformSync, 'getEpicOrderStableId');
    const dedupe = extractByName(platformSync, 'normalizeEpicUniqueOrders');
    const processor = extractByName(platformSync, 'processEpicOrdersForVault');
    assert.match(stable, /orderId \|\| order\.id \|\| order\.orderNumber/);
    assert.match(dedupe, /getEpicOrderStableId\(order\)/);
    assert.match(dedupe, /duplicateOrdersDropped \+= 1/);
    assert.match(processor, /normalizeEpicUniqueOrders\(orders\)/);
});

test('Transaction lifecycle rows cannot be blindly summed as independent payments', () => {
    const amount = extractByName(platformSync, 'getEpicAuthoritativeOrderAmount');
    const legacy = extractByName(platformSync, 'getEpicOrderAmountMinor');
    assert.match(amount, /settled_transaction_unique_max/);
    assert.match(amount, /AUTH|AUTHORIZE|AUTHORIZED|PENDING|VOID|FAILED|DECLINED|CANCEL/);
    assert.doesNotMatch(legacy, /transactions\.reduce\(\(sum, tx\) => sum \+ Number/);
});

test('Refunds reduce net and never increase gross purchases', () => {
    const fn = extractByName(platformSync, 'processEpicOrdersForVault');
    assert.match(fn, /addEpicMinor\(refundsByCurrency, orderCurrency, amountMinor\)/);
    assert.match(fn, /addEpicMinor\(netSpentByCurrency, orderCurrency, -amountMinor\)/);
    const refundBranch = fn.slice(fn.indexOf('} else if (isRefund)'), fn.indexOf('} else {', fn.indexOf('} else if (isRefund)')));
    assert.doesNotMatch(refundBranch, /grossPurchasesByCurrency/);
});

test('Cancelled failed and zero-value claims do not count as money spent', () => {
    const fn = extractByName(platformSync, 'processEpicOrdersForVault');
    assert.match(fn, /cancelledOrdersCount \+= 1/);
    assert.match(fn, /continue;/);
    assert.match(fn, /freeClaimsCount \+= 1/);
    const freeBranch = fn.slice(fn.indexOf('if (amountMinor === 0)'), fn.indexOf('} else if (isRefund)'));
    assert.doesNotMatch(freeBranch, /grossPurchasesByCurrency|netSpentByCurrency/);
});

test('Mixed currencies are kept in currency buckets instead of one mislabeled total', () => {
    const fn = extractByName(platformSync, 'processEpicOrdersForVault');
    for (const token of ['grossPurchasesByCurrency', 'refundsByCurrency', 'netSpentByCurrency', 'multipleCurrencies']) {
        assert.match(fn, new RegExp(token));
    }
    assert.match(fn, /currency: multipleCurrencies \? 'MULTI'/);
});

test('FAB spend remains separate from game spend', () => {
    const fn = extractByName(platformSync, 'processEpicOrdersForVault');
    assert.match(fn, /fabSpendByCurrency/);
    assert.match(fn, /gameSpendByCurrency/);
    assert.match(fn, /addEpicMinor\(isFab \? fabSpendByCurrency : gameSpendByCurrency/);
});

test('catalogItemId is preserved separately and never assigned as offerId in Vault orders', () => {
    const normalizer = extractByName(platformSync, 'normalizeEpicPurchaseHistoryItems');
    const processor = extractByName(platformSync, 'processEpicOrdersForVault');
    assert.match(normalizer, /catalogItemId:/);
    assert.match(processor, /catalogItemId:/);
    assert.doesNotMatch(normalizer, /offerId:.*catalogItemId/);
    assert.doesNotMatch(processor, /offerId:.*catalogItemId/);
});

test('Price resolution supports offer id and catalog-item resolution sources', () => {
    const fetcher = extractByName(platformSync, 'fetchEpicLivePriceForEntry');
    assert.match(fetcher, /resolutionSource = ref\.offerId \? 'offer_id'/);
    assert.match(fetcher, /resolveEpicOfferFromCatalogItem\(ref, pricingCountry, options\)/);
    assert.match(fetcher, /resolutionSource = 'catalog_item'/);
});


test('Price resolution includes verified appName/title fallback after stronger identities', () => {
    const fallback = extractByName(platformSync, 'resolveEpicOfferFromVerifiedFallback');
    const fetcher = extractByName(platformSync, 'fetchEpicLivePriceForEntry');
    assert.match(fallback, /verifyEpicOfferMatchesRef\(offer, ref\)/);
    assert.match(fallback, /'app_name' : 'title_verified'/);
    assert.match(fetcher, /resolveEpicOfferFromVerifiedFallback\(ref, pricingCountry, options\)/);
});
test('Live price records preserve separate identity and resolution status fields', () => {
    const catalogOffer = extractByName(platformSync, 'fetchEpicCatalogOffer');
    for (const token of ['namespace', 'offerId', 'catalogItemId', 'appName', 'title', 'amount', 'originalAmount', 'currency', 'discountPercent', 'priceStatus', 'resolutionSource', 'resolvedAt']) {
        assert.match(catalogOffer, new RegExp(token));
    }
});

test('Price states distinguish priced free not_for_sale and unresolved', () => {
    assert.match(platformSync, /priceStatus: current === 0 \? 'free' : 'priced'/);
    assert.match(platformSync, /priceStatus = 'not_for_sale'|not_for_sale/);
    assert.match(platformSync, /priceStatus = 'unresolved'|unresolved/);
    const current = extractByName(sidebar, '_vaultGetCurrentPriceView');
    assert.match(current, /status === 'not_for_sale'/);
    assert.match(current, /status: 'unresolved'/);
});

test('Partial price refresh merges fresh records with old cache instead of replacing all prices', () => {
    const merger = extractByName(platformSync, 'mergeEpicLivePrices');
    const syncSingle = extractByName(platformSync, 'syncSingleEpicAccount');
    assert.match(merger, /preservedFromPreviousCache/);
    assert.match(merger, /canReplace = status === 'priced' \|\| status === 'free' \|\| status === 'not_for_sale'/);
    assert.match(syncSingle, /livePrices = mergeEpicLivePrices\(livePrices, fetchedLivePrices\)/);
    assert.doesNotMatch(syncSingle, /livePrices = fetchedLivePrices/);
});

test('Vault overview is an explicit state and does not normalize to Epic', () => {
    const normalizer = extractByName(sidebar, 'normalizeVaultPlatform');
    const opener = extractByName(sidebar, 'openVaultPlatform');
    assert.match(dashboard, /data-vault-state="overview"/);
    assert.match(normalizer, /return 'overview'/);
    assert.doesNotMatch(normalizer, /: 'epic'/);
    assert.match(opener, /selectVaultPlatform\(platform\)/);
});

test('Selecting Epic renders platform state and account selection without choosing first account', () => {
    const select = extractByName(sidebar, 'selectVaultPlatform');
    const accounts = extractByName(sidebar, '_renderVaultEpicAccounts');
    assert.match(select, /_setVaultState\('platform', 'epic'\)/);
    assert.doesNotMatch(accounts, /Back to Platforms/);
    assert.match(dashboard, /id="vaultTopBack"/);
    assert.doesNotMatch(accounts, /accounts\s*\[\s*0\s*\]/);
});

test('Back navigation uses cache and does not call sync or auth', () => {
    const backAccount = extractByName(sidebar, 'backToVaultEpicAccounts');
    const backPlatforms = extractByName(sidebar, 'backToVaultPlatforms');
    assert.match(backAccount, /_renderVaultEpicFromCache\(\)/);
    assert.match(backPlatforms, /_renderVaultOverview\(\)/);
    assert.doesNotMatch(`${backAccount}\n${backPlatforms}`, /platformSyncSync|platformSyncLink|openEpicLoginWindow|runLegendary|hydrateEpicVaultConsole/);
});

test('Vault platform and account states hide chooser and use full width', () => {
    assert.match(css, /vault-page\[data-vault-state="platform"\] \.vault-access[\s\S]*display:\s*none/);
    assert.match(css, /vault-page\[data-vault-state="account"\] \.vault-access[\s\S]*display:\s*none/);
    assert.match(css, /vault-page\[data-vault-state="platform"\] \.vault-core[\s\S]*grid-template-columns:\s*1fr/);
    assert.doesNotMatch(css, /vault-console:has/);
});

test('Epic library grid fills available width responsively', () => {
    const matches = [...css.matchAll(/#vaultView \.vault-epic-library-grid \{[\s\S]*?\}/g)];
    const match = matches.find((item) => /grid-template-columns/.test(item[0]));
    assert.ok(match, 'Vault-scoped library grid layout rule should exist');
    const grid = match[0];
    assert.match(grid, /repeat\(auto-fill, minmax\(160px, 1fr\)\)/);
    assert.match(grid, /justify-content:\s*stretch/);
    assert.match(grid, /max-height:\s*none/);
    assert.doesNotMatch(grid, /overflow:\s*auto/);
});

test('Vault redesign removes the oversized hero and platform meter', () => {
    assert.match(dashboard, /vault-compact-header/);
    assert.match(dashboard, /id="vaultTopBack"/);
    assert.doesNotMatch(dashboard, /vault-hero-meter|vault-meter-core|04\s*Platforms/i);
});

test('Epic Vault account header shows useful account context instead of technical coverage counts', () => {
    const fn = extractByName(sidebar, '_renderVaultEpicAccountDetail');
    assert.match(sidebar, /Region:/);
    assert.match(sidebar, /Store Currency:/);
    assert.match(sidebar, /_vaultCountryLabel\(account\.pricingCountry\)/);
    assert.match(sidebar, /_vaultStoreCurrency\(account\)/);
    assert.doesNotMatch(fn, /priced\/?free|unresolved|priced or free|resolvedGames\s*}\s*\/\s*\$\{coverage\.totalGames/i);
});

test('Epic Vault financial summary uses compact cards with explanatory tooltips', () => {
    const fn = extractByName(sidebar, '_vaultFinanceGridHtml');
    for (const token of ['Current Library Value', 'Gross Purchases', 'Refunds', 'Net Spent', '_vaultMetricCard']) {
        assert.match(fn, new RegExp(token));
    }
    assert.match(sidebar, /data-vault-finance-grid/);
    assert.match(css, /\.vault-metric-card\.is-current/);
    assert.match(css, /\.vault-info:hover::after/);
});

test('Vault spend formatting displays currency buckets as separate lines without joining totals', () => {
    const lines = extractByName(sidebar, '_vaultCurrencyLines');
    const label = extractByName(sidebar, '_vaultSpendLabel');
    const html = extractByName(sidebar, '_vaultSpendHtml');
    assert.match(lines, /currency !== 'MULTI'/);
    assert.ok(label.includes("join('\\n')"));
    assert.match(html, /\.map\(\(line\)/);
    assert.doesNotMatch(label, / \+ /);
});
test('Vault platform cards are wired to open platform state on click', () => {
    assert.match(dashboard, /id="vault-card-epic"[^>]*data-vault-platform="epic"/);
    assert.doesNotMatch(dashboard, /id="vault-card-epic"[^>]*onclick=/);
    const binder = extractByName(sidebar, 'bindVaultPlatformGridClicks');
    assert.match(binder, /vaultPlatformGrid/);
    assert.match(binder, /closest\?\.\('\.vault-platform-card'\)/);
    assert.match(binder, /openVaultPlatform\(platform\)/);
});
function createVaultRuntimeSandbox() {
    const elements = new Map();
    class FakeClassList {
        constructor() { this.values = new Set(); }
        add(...names) { names.forEach(name => this.values.add(name)); }
        remove(...names) { names.forEach(name => this.values.delete(name)); }
        contains(name) { return this.values.has(name); }
    }
    class FakeElement {
        constructor(id = '') {
            this.id = id;
            this.dataset = {};
            this.style = {};
            this.classList = new FakeClassList();
            this.innerHTML = '';
            this.textContent = '';
            this.listeners = {};
            this.offsetWidth = 100;
        }
        addEventListener(type, fn) { this.listeners[type] = fn; }
        dispatchEvent(event) { this.listeners[event.type]?.(event); }
        contains(target) { return target === this || target?.parent === this; }
        closest(selector) { return selector === '.vault-platform-card' && this.classList.contains('vault-platform-card') ? this : null; }
    }
    const get = (id) => {
        if (!elements.has(id)) elements.set(id, new FakeElement(id));
        return elements.get(id);
    };
    const vaultPage = get('vaultPage');
    vaultPage.dataset.vaultState = 'overview';
    const grid = get('vaultPlatformGrid');
    const epicCard = get('vault-card-epic');
    epicCard.parent = grid;
    epicCard.classList.add('vault-platform-card');
    epicCard.dataset.vaultPlatform = 'epic';

    const calls = { vaultPromise: null, hydrate: 0, errors: [], auth: 0, sync: 0, vaultResponse: null, epicProgressListener: null, accountsChangedListener: null, libraryCommittedListener: null };
    const document = {
        readyState: 'complete',
        getElementById: get,
        querySelectorAll(selector) {
            if (selector === '.vault-platform-card.active') {
                return [...elements.values()].filter(el => el.classList.contains('vault-platform-card') && el.classList.contains('active'));
            }
            if (selector === '.nav-item.active, .platform-item.active, .vault-item.active, [data-collection-id].active, #igFavoritesFilter.active') return [];
            return [];
        },
        addEventListener() {},
    };
    const sandbox = {
        document,
        localStorage: { getItem: () => null, setItem() {} },
        console: { error: (message) => calls.errors.push(String(message)), log() {}, warn() {} },
        Intl,
        Promise,
        performance: { now: () => Date.now() },
        setTimeout: (fn) => { fn(); return 1; },
        clearTimeout() {},
        currentView: 'vault',
        currentAccountPlatform: null,
        currentFilters: { collectionId: null, platform: 'all', search: '' },
        _hideAllViews() {},
        updateSidebarActiveState() {},
        syncSidebarActionButton() {},
        escapeHtml(value) { return String(value ?? ''); },
        window: null,
    };
    sandbox.window = {
        document,
        localStorage: sandbox.localStorage,
        console: sandbox.console,
        agReadyOnly: false,
        VaultOverviewModel,
        VaultHydrationClient,
        clearTimeout: sandbox.clearTimeout,
        setTimeout: sandbox.setTimeout,
        electronAPI: {
            platformSyncGetEpicVault: async () => {
                calls.hydrate += 1;
                if (calls.vaultPromise) return calls.vaultPromise;
                if (calls.vaultResponse) return calls.vaultResponse;
                return {
                    vault: {
                        accounts: [{
                            accountId: 'epic-account-b',
                            displayName: 'Epic Account B',
                            permissions: { purchaseHistory: true },
                            primaryCurrency: 'USD',
                            currency: 'USD',
                            grossPurchasesMinor: 50000,
                            refundsMinor: 8000,
                            netSpentMinor: 42000,
                            actualSpent: 420,
                            games: [{
                                title: 'Runtime Game',
                                namespace: 'ns1',
                                offerId: 'offer1',
                                coverUrl: 'cover.webp',
                                priceStatus: 'priced',
                                livePrice: { amount: 5999, currency: 'USD', priceResolved: true },
                            }],
                            purchaseHistoryItems: [{
                                title: 'Runtime Game',
                                namespace: 'ns1',
                                offerId: 'offer1',
                                amount: 42,
                                amountMinor: 4200,
                                currency: 'USD',
                                status: 'Completed',
                                date: '2026-08-19T00:00:00.000Z',
                            }],
                        }],
                    },
                };
            },
            onEpicSyncProgress: (callback) => { calls.epicProgressListener = callback; },
            onPlatformSyncAccountsChanged: (callback) => { calls.accountsChangedListener = callback; },
            onPlatformLibraryCommitted: (callback) => { calls.libraryCommittedListener = callback; },
            platformSyncGetEpicProgressState: async () => ({ state: {} }),
            platformSyncSync: async () => { calls.sync += 1; },
            platformSyncLink: async () => { calls.auth += 1; },
        },
        addEventListener() {},
    };
    sandbox.globalThis = sandbox.window;
    sandbox.window.window = sandbox.window;
    sandbox.window.__calls = calls;
    vm.createContext(sandbox);

    const start = sidebar.indexOf('const VAULT_PLATFORM_META');
    const end = sidebar.indexOf('function handleSidebarContextBtn');
    assert.ok(start > -1 && end > start, 'Vault source block should be extractable');
    const vaultBlock = `${sidebar.slice(start, end)}\nObject.assign(window, { openVaultPlatform, selectVaultPlatform, selectVaultEpicAccount, backToVaultEpicAccounts, backToVaultPlatforms, _setVaultState, _vaultSpendLabel, _vaultActualSpentLabel, invalidateEpicVaultCache, _vaultPrepareLibraryGames, _vaultDedupeLibraryGames, _vaultCanonicalGameKey, _vaultBuildPurchaseMap, _vaultGetPurchasePriceView, _vaultPrepareHistoryItems, _vaultBuildRetainedPurchaseCards, _vaultRepresentedPurchaseTotal, _vaultRenderEpicCover, _vaultCoverCandidatesForGame, _vaultHasLocalCoverCandidate, _vaultFindAllGamesArtworkForEpic, _vaultIdentityKeys, _vaultBuildLibraryGameIndex, _vaultFindLibraryGameMatchForPurchase, _vaultBuildArtworkIndex, _vaultCreateEpicRenderContext, _vaultArtworkAliasesForGame, _vaultLegacyArtworkAliasKeys, _vaultLibraryResultsHtml, _vaultEpicCoverage, _renderVaultEpicLibraryResults, _renderVaultEpicHistoryResults, _vaultRenderHistoryArtwork, _vaultHistoryArtworkCandidates, _vaultHistoryArtworkSubject, _vaultQueueMissingCoverWarm, _vaultEpicHistoryStatus, _vaultHistoryStableId, _vaultHistoryLastUpdatedLabel, refreshVaultEpicPurchaseHistory, handleVaultEpicCoverError, markVaultEpicCoverLoaded, setVaultEpicPriceMode, setVaultEpicLibraryFilter, setVaultEpicLibrarySearch, setVaultEpicHistoryFilter, setVaultEpicHistoryCurrency, setVaultEpicHistorySearch, bindVaultBackToTop, scrollVaultToTop });`;
    vm.runInContext(vaultBlock, sandbox, { filename: 'sidebar-vault-block.js' });
    return { sandbox, elements, calls, grid, epicCard, vaultPage };
}


test('Epic Vault IPC path reconciles linked accounts with Vault projection', () => {
    assert.match(platformSync, /function reconcileEpicVaultWithLinkedAccounts/);
    assert.match(platformSync, /getEpicAccountsList\(\)/);
    assert.match(platformSync, /readEpicMergedLibrary\(\)/);
    assert.match(platformSync, /readReconciledEpicVault\(/);
    const handler = platformSync.slice(platformSync.indexOf("platform-sync:get-epic-vault"), platformSync.indexOf("platform-sync:unlink"));
    assert.match(handler, /epicVaultHydrationService\.handle\(\)/);
});

test('Games-only Epic sync persists a minimal Vault record without optional fetch gates', () => {
    const fn = extractByName(platformSync, 'syncSingleEpicAccount');
    const cleanupIndex = fn.indexOf('removeEpicNonGameEntries');
    const mergeIndex = fn.indexOf('mergeEpicVaultValuation', cleanupIndex);
    const priceFetchIndex = fn.indexOf('if (syncOptions.currentPrices)', cleanupIndex);
    const historyFetchIndex = fn.indexOf('if (syncOptions.purchaseHistory', cleanupIndex);
    assert.ok(mergeIndex > cleanupIndex, 'Vault merge should run after library sync cleanup');
    assert.ok(priceFetchIndex > cleanupIndex, 'Current price fetch remains optional');
    assert.equal(historyFetchIndex, -1, 'Purchase History has no competing syncSingleEpicAccount pipeline');
    assert.match(platformSync, /EpicPurchaseHistoryRefreshService/);
    const gateIndex = fn.indexOf('if (syncOptions.currentPrices || syncOptions.purchaseHistory)', cleanupIndex);
    assert.equal(gateIndex, -1, 'Vault persistence must not be gated by optional price/history flags');
});

test('Epic unlink removes the single Vault account instead of leaving stale Vault data', () => {
    assert.match(platformSync, /removeEpicVaultAccount\(accountId\)/);
    assert.match(fs.readFileSync(path.join(ROOT, 'src/features/sync/infrastructure/repositories/PlatformSyncCacheRepository.js'), 'utf8'), /async removeEpicVaultAccount\(accountId\)/);
});

test('Epic renderer exposes cache invalidation and link sync unlink call sites refresh it', () => {
    const accountsJs = fs.readFileSync(path.join(ROOT, 'src/js/accounts.js'), 'utf8');
    const panelsJs = fs.readFileSync(path.join(ROOT, 'src/js/accounts/platform-panels.js'), 'utf8');
    assert.match(sidebar, /function invalidateEpicVaultCache\(refresh = false, options = \{\}\)/);
    assert.doesNotMatch(extractByName(sidebar, 'invalidateEpicVaultCache'), /__vaultEpicDataCache = null/);
    assert.match(accountsJs, /invalidateEpicVaultCache\(true\)/);
    assert.match(panelsJs, /invalidateEpicVaultCache\(true\)/);
});

test('Epic account detail no longer sets duplicated Epic Games Vault console header', () => {
    const fn = extractByName(sidebar, '_renderVaultEpicAccountDetail');
    assert.doesNotMatch(fn, /Epic Games Vault/);
    assert.doesNotMatch(fn, /_setVaultReadout\('vaultReadoutAccountsLabel'/);
    assert.match(css, /vault-page\[data-vault-state="account"\] \.vault-compact-header[\s\S]*display:\s*none/);
});

test('Vault runtime invalidation refetches local Vault data without auth or sync', async () => {
    const { sandbox, calls } = createVaultRuntimeSandbox();
    sandbox.window._setVaultState('platform', 'epic');
    await sandbox.window.invalidateEpicVaultCache(true);
    assert.equal(calls.hydrate, 1);
    assert.equal(calls.auth, 0);
    assert.equal(calls.sync, 0);
});

test('Default Current Library view filters to priced games high-to-low', () => {
    const { sandbox } = createVaultRuntimeSandbox();
    const account = {
        games: [
            { title: 'Free Game', priceStatus: 'free', livePrice: { amount: 0, currency: 'USD', priceResolved: true } },
            { title: 'Cheap Game', priceStatus: 'priced', livePrice: { amount: 1999, currency: 'USD', priceResolved: true } },
            { title: 'Missing Price', priceStatus: 'unresolved' },
            { title: 'Expensive Game', priceStatus: 'priced', livePrice: { amount: 5999, currency: 'USD', priceResolved: true } },
        ],
    };
    const visible = sandbox.window._vaultPrepareLibraryGames(account, new Map());
    assert.deepEqual(visible.map((game) => game.title), ['Expensive Game', 'Cheap Game']);
    assert.deepEqual(account.games.map((game) => game.title), ['Free Game', 'Cheap Game', 'Missing Price', 'Expensive Game']);
});

test('Current Library filters priced all free sale unavailable and search by title', () => {
    const { sandbox } = createVaultRuntimeSandbox();
    const account = { games: [
        { title: 'Paid Sale', priceStatus: 'priced', livePrice: { amount: 5000, currency: 'USD', isDiscounted: true, priceResolved: true } },
        { title: 'Paid Normal', priceStatus: 'priced', livePrice: { amount: 1000, currency: 'USD', priceResolved: true } },
        { title: 'Free Claim', priceStatus: 'free', livePrice: { amount: 0, currency: 'USD', priceResolved: true } },
        { title: 'Unknown Thing', priceStatus: 'unresolved' },
    ] };
    sandbox.window.setVaultEpicPriceMode('current');
    sandbox.window.setVaultEpicLibraryFilter('priced');
    assert.deepEqual(sandbox.window._vaultPrepareLibraryGames(account, new Map()).map(g => g.title), ['Paid Sale', 'Paid Normal']);
    sandbox.window.setVaultEpicLibraryFilter('free');
    assert.deepEqual(sandbox.window._vaultPrepareLibraryGames(account, new Map()).map(g => g.title), ['Free Claim']);
    sandbox.window.setVaultEpicLibraryFilter('sale');
    assert.deepEqual(sandbox.window._vaultPrepareLibraryGames(account, new Map()).map(g => g.title), ['Paid Sale']);
    sandbox.window.setVaultEpicLibraryFilter('unavailable');
    assert.deepEqual(sandbox.window._vaultPrepareLibraryGames(account, new Map()).map(g => g.title), ['Unknown Thing']);
    sandbox.window.setVaultEpicLibraryFilter('all');
    sandbox.window.setVaultEpicLibrarySearch('normal');
    assert.deepEqual(sandbox.window._vaultPrepareLibraryGames(account, new Map()).map(g => g.title), ['Paid Normal']);
});

test('Purchase mode renders only real paid game purchases and prefers paid over free claims', () => {
    const { sandbox } = createVaultRuntimeSandbox();
    const account = {
        games: [
            { title: 'Paid Game', namespace: 'ns', offerId: 'paid' },
            { title: 'Free Game', namespace: 'ns', offerId: 'free' },
            { title: 'Refunded Game', namespace: 'ns', offerId: 'refund' },
            { title: 'No Record', namespace: 'ns', offerId: 'none' },
            { title: 'Fab Asset', namespace: 'ns', offerId: 'fab' },
        ],
        purchaseHistoryItems: [
            { title: 'Paid Game', namespace: 'ns', offerId: 'paid', amountMinor: 0, amount: 0, currency: 'USD', status: 'Completed' },
            { title: 'Paid Game', namespace: 'ns', offerId: 'paid', amountMinor: 4200, amount: 42, currency: 'USD', status: 'Completed' },
            { title: 'Free Game', namespace: 'ns', offerId: 'free', amountMinor: 0, amount: 0, currency: 'USD', status: 'Completed' },
            { title: 'Refunded Game', namespace: 'ns', offerId: 'refund', amountMinor: 1200, amount: 12, currency: 'USD', isRefund: true, status: 'Refunded' },
            { title: 'Fab Asset', namespace: 'ns', offerId: 'fab', amountMinor: 3300, amount: 33, currency: 'USD', isFab: true, status: 'Completed' },
        ],
    };
    sandbox.window.setVaultEpicPriceMode('purchase');
    const purchaseMap = sandbox.window._vaultBuildPurchaseMap(account);
    const visible = sandbox.window._vaultPrepareLibraryGames(account, purchaseMap);
    assert.deepEqual(visible.map((game) => game.title), ['Paid Game']);
    const view = sandbox.window._vaultGetPurchasePriceView(account.games[0], account, purchaseMap);
    assert.match(view.label, /USD 42\.00/);
});


test('Purchase Library is generated from purchase history even when purchase is not in account.games', () => {
    const { sandbox } = createVaultRuntimeSandbox();
    const account = {
        games: [],
        purchaseHistoryItems: [
            { title: 'Just Cause 4 Reloaded', amountMinor: 284, amount: 2.84, currency: 'USD', status: 'Completed' },
        ],
    };
    sandbox.window.setVaultEpicPriceMode('purchase');
    sandbox.window.setVaultEpicLibrarySearch('');
    const cards = sandbox.window._vaultPrepareLibraryGames(account, new Map());
    assert.equal(cards.length, 1);
    assert.equal(cards[0].title, 'Just Cause 4 Reloaded');
    assert.equal(cards[0].netPaidMinor, 284);
    assert.equal(cards[0].__vaultMatchedGame, null);
});

test('Purchase Library excludes fully refunded purchases while raw history can retain them', () => {
    const { sandbox } = createVaultRuntimeSandbox();
    const account = {
        games: [],
        purchaseHistoryItems: [
            { title: 'Red Dead Redemption 2', amountMinor: 1499, amount: 14.99, currency: 'USD', status: 'Completed' },
            { title: 'Red Dead Redemption 2', amountMinor: 1499, amount: 14.99, currency: 'USD', isRefund: true, status: 'Refunded' },
        ],
    };
    sandbox.window.setVaultEpicPriceMode('purchase');
    assert.equal(account.purchaseHistoryItems.length, 2);
    assert.deepEqual(sandbox.window._vaultPrepareLibraryGames(account, new Map()), []);
});

test('Purchase Library reconciles the six retained paid games to 1756 minor units', () => {
    const { sandbox } = createVaultRuntimeSandbox();
    const account = {
        games: [
            { title: 'Detroit', coverUrl: 'detroit.webp' },
            { title: 'Tomb Raider', coverUrl: 'tomb.webp' },
            { title: 'Alan Wake', coverUrl: 'alan.webp' },
            { title: 'Battlefield 1', coverUrl: 'bf1.webp' },
            { title: 'Space Accident', coverUrl: 'space.webp' },
        ],
        purchaseHistoryItems: [
            { title: 'Red Dead Redemption 2', amountMinor: 1499, amount: 14.99, currency: 'USD', status: 'Completed' },
            { title: 'Red Dead Redemption 2', amountMinor: 1499, amount: 14.99, currency: 'USD', isRefund: true, status: 'Refunded' },
            { title: 'Detroit', amountMinor: 749, amount: 7.49, currency: 'USD', status: 'Completed' },
            { title: 'Tomb Raider', amountMinor: 299, amount: 2.99, currency: 'USD', status: 'Completed' },
            { title: 'Just Cause 4 Reloaded', amountMinor: 284, amount: 2.84, currency: 'USD', status: 'Completed' },
            { title: 'Alan Wake', amountMinor: 209, amount: 2.09, currency: 'USD', status: 'Completed' },
            { title: 'Battlefield 1', amountMinor: 199, amount: 1.99, currency: 'USD', status: 'Completed' },
            { title: 'Might & Magic Heroes 3', amountMinor: 124, amount: 1.24, currency: 'USD', status: 'Completed' },
            { title: 'Might & Magic Heroes 3', amountMinor: 124, amount: 1.24, currency: 'USD', isRefund: true, status: 'Refunded' },
            { title: 'Space Accident', amountMinor: 16, amount: 0.16, currency: 'USD', status: 'Completed' },
        ],
    };
    sandbox.window.setVaultEpicPriceMode('purchase');
    sandbox.window.setVaultEpicLibrarySearch('');
    const cards = sandbox.window._vaultPrepareLibraryGames(account, new Map());
    assert.deepEqual(cards.map((card) => card.title), ['Detroit', 'Tomb Raider', 'Just Cause 4 Reloaded', 'Alan Wake', 'Battlefield 1', 'Space Accident']);
    const totals = sandbox.window._vaultRepresentedPurchaseTotal(cards);
    assert.equal(totals.USD, 1756);
});

test('Purchase Library enriches metadata when a library match exists and keeps financial history as source', () => {
    const { sandbox } = createVaultRuntimeSandbox();
    const account = {
        games: [{ title: 'Library Canonical Title', namespace: 'ns', offerId: 'offer', coverUrl: 'file://cached.webp' }],
        purchaseHistoryItems: [{ title: 'Purchase Receipt Title', namespace: 'ns', offerId: 'offer', amountMinor: 999, amount: 9.99, currency: 'USD', status: 'Completed' }],
    };
    sandbox.window.setVaultEpicPriceMode('purchase');
    const [card] = sandbox.window._vaultPrepareLibraryGames(account, new Map());
    assert.equal(card.title, 'Purchase Receipt Title');
    assert.equal(card.netPaidMinor, 999);
    assert.equal(card.__vaultPurchase.title, 'Purchase Receipt Title');
    assert.equal(card.coverUrl, 'file://cached.webp');
});

test('Epic Vault cover errors never advance to remote fallback candidates', () => {
    const { sandbox } = createVaultRuntimeSandbox();
    const img = {
        dataset: { coverKey: 'cover-test', coverIndex: '0', coverCandidates: encodeURIComponent(JSON.stringify(['https://bad.example/cover.webp', 'file://good-cover.webp'])) },
        src: 'https://bad.example/cover.webp',
        outerHTML: '',
        closest() { return null; },
    };
    sandbox.window.handleVaultEpicCoverError(img);
    assert.equal(img.dataset.coverIndex, '0');
    assert.notEqual(img.src, 'file://good-cover.webp');
    assert.match(img.outerHTML, /vault-epic-cover-fallback/);
});
test('Epic Vault cover fallback replaces exhausted candidates with placeholder', () => {
    const { sandbox } = createVaultRuntimeSandbox();
    const candidates = encodeURIComponent(JSON.stringify(['https://bad.example/cover.webp']));
    const img = {
        dataset: { coverKey: 'cover-empty', coverIndex: '0', coverCandidates: candidates },
        src: 'https://bad.example/cover.webp',
        outerHTML: '',
        getAttribute(name) { return name === 'src' ? this.src : null; },
        closest() { return null; },
    };
    sandbox.window.handleVaultEpicCoverError(img);
    assert.match(img.outerHTML, /vault-epic-cover-fallback/);
});

test('Epic Vault cover rendering uses local cached candidates only and never serializes remote fallbacks', () => {
    const { sandbox } = createVaultRuntimeSandbox();
    const html = sandbox.window._vaultRenderEpicCover({
        title: 'Cached Cover Wins',
        coverCandidates: [{ url: 'file://cached-cover.webp', source: 'library_image' }, { url: 'https://remote.example/cover.webp', source: 'remote' }],
        coverUrl: 'https://remote.example/cover.webp',
    });
    assert.match(html, /src="file:\/\/cached-cover\.webp"/);
    assert.doesNotMatch(html, /https:\/\/remote\.example/);
    assert.doesNotMatch(html, /data-cover-candidates=/);
});
test('Epic Vault purchase cards use one full-cover artwork wrapper with overlay title and price', () => {
    const render = `${extractByName(sidebar, '_vaultLibraryResultsHtml')}\n${extractByName(sidebar, '_vaultEpicCardHtml')}`;
    assert.match(render, /game-card-img-wrap vault-epic-card-artwork/);
    assert.match(render, /vault-epic-card-price/);
    assert.match(render, /ag-card-display-overlay/);
    assert.match(render, /ag-card-display-title/);
    assert.doesNotMatch(render, /game-card-info|gc-info|vault-epic-card-footer/);
    const cssTail = css.slice(css.lastIndexOf('Epic Vault fix pass'));
    assert.match(cssTail, /\.vault-epic-cover-card \.vault-epic-card-artwork/);
    assert.match(cssTail, /inset:\s*0/);
    assert.match(cssTail, /object-fit:\s*cover/);
    assert.match(cssTail, /inset:\s*auto 0 0 0/);
});



test('Epic Vault identity keys are null-safe at the boundary', () => {
    const { sandbox } = createVaultRuntimeSandbox();
    assert.deepEqual(sandbox.window._vaultIdentityKeys(null), []);
    assert.deepEqual(sandbox.window._vaultIdentityKeys(undefined), []);
});


test('Purchase Library matching does not collapse DLC or editions by substring', () => {
    const { sandbox } = createVaultRuntimeSandbox();
    const libraryIndex = sandbox.window._vaultBuildLibraryGameIndex([
        { title: 'Cyberpunk 2077', namespace: 'cp-ns', offerId: 'base-offer', catalogItemId: 'base-catalog' },
        { title: 'Some Game', namespace: 'some-ns', offerId: 'some-base' },
    ]);

    const dlc = sandbox.window._vaultFindLibraryGameMatchForPurchase({
        title: 'Cyberpunk 2077: Phantom Liberty',
        namespace: 'cp-ns',
        offerId: 'phantom-offer',
        catalogItemId: 'phantom-catalog',
    }, libraryIndex);
    const edition = sandbox.window._vaultFindLibraryGameMatchForPurchase({
        title: 'Some Game Ultimate Edition',
        namespace: 'some-ns',
        offerId: 'some-ultimate',
    }, libraryIndex);

    assert.equal(dlc.game, null);
    assert.equal(dlc.type, null);
    assert.equal(edition.game, null);
    assert.equal(edition.type, null);
});

test('Purchase Library allows exact title match and strong IDs override title differences', () => {
    const { sandbox } = createVaultRuntimeSandbox();
    const libraryIndex = sandbox.window._vaultBuildLibraryGameIndex([
        { title: 'The Telltale Batman Shadows Edition', namespace: 'bat-ns' },
        { title: 'Library Canonical Title', namespace: 'id-ns', offerId: 'shared-offer' },
    ]);

    const exact = sandbox.window._vaultFindLibraryGameMatchForPurchase({ title: 'The Telltale Batman Shadows Edition' }, libraryIndex);
    const strong = sandbox.window._vaultFindLibraryGameMatchForPurchase({ title: 'Receipt Title', namespace: 'id-ns', offerId: 'shared-offer' }, libraryIndex);

    assert.equal(exact.game.title, 'The Telltale Batman Shadows Edition');
    assert.equal(exact.type, 'exact_title');
    assert.equal(strong.game.title, 'Library Canonical Title');
    assert.equal(strong.type, 'strong_identity');
});

test('Purchase Library card keeps purchase title authoritative when enriched by Legendary artwork', () => {
    const { sandbox } = createVaultRuntimeSandbox();
    sandbox.window.setVaultEpicPriceMode('purchase');
    const account = {
        games: [{ title: 'Library Canonical Title', namespace: 'ns', offerId: 'offer', coverUrl: 'file://legendary-cover.webp' }],
        purchaseHistoryItems: [{ title: 'Purchase Receipt Title', namespace: 'ns', offerId: 'offer', amountMinor: 999, amount: 9.99, currency: 'USD', status: 'Completed' }],
    };
    const [card] = sandbox.window._vaultPrepareLibraryGames(account, new Map());
    assert.equal(card.title, 'Purchase Receipt Title');
    assert.equal(card.__vaultMatchedGame.title, 'Library Canonical Title');
    assert.equal(card.__vaultMatchType, 'strong_identity');
    assert.equal(card.coverUrl, 'file://legendary-cover.webp');
});

test('Epic Purchase artwork enrichment reuses catalog price resolver and persists cover fields', () => {
    const enrich = extractByName(platformSync, 'enrichEpicPurchaseHistoryArtwork');
    const catalog = extractByName(platformSync, 'resolveEpicPurchaseCatalogArtwork');
    const apply = extractByName(platformSync, 'applyEpicPurchaseArtwork');
    assert.match(enrich, /buildEpicPurchaseArtworkCache/);
    assert.match(enrich, /findEpicLivePriceArtwork/);
    assert.match(enrich, /resolveEpicPurchaseCatalogArtwork/);
    assert.match(catalog, /resolveEpicOfferFromCatalogItem/);
    assert.match(catalog, /fetchEpicCatalogOffer/);
    assert.match(catalog, /epicArtworkFromOffer/);
    assert.match(apply, /coverUrl/);
    assert.match(apply, /coverCandidates/);
    assert.match(apply, /artworkSource/);
    assert.match(apply, /source: item\.source \|\| 'purchase_history'/);
});

test('Epic Purchase artwork cache avoids repeated catalog lookup when cached cover exists', () => {
    const enrich = extractByName(platformSync, 'enrichEpicPurchaseHistoryArtwork');
    const own = extractByName(platformSync, 'getEpicPurchaseOwnArtwork');
    assert.match(enrich, /const own = getEpicPurchaseOwnArtwork\(item\)/);
    assert.match(enrich, /if \(own\) return applyEpicPurchaseArtwork\(item, own\)/);
    assert.match(enrich, /findEpicPurchaseCachedArtwork/);
    assert.match(own, /coverCandidates/);
    assert.match(own, /coverUrl/);
});

test('Purchase-only Epic cards fully render when matched library game is null', () => {
    const { sandbox } = createVaultRuntimeSandbox();
    const account = {
        games: [],
        purchaseHistoryItems: [
            { stableOrderId: 'try-460', title: 'Cyberpunk 2077: Phantom Liberty', amountMinor: 46046, currency: 'TRY', status: 'Completed' },
            { stableOrderId: 'try-130', title: 'Dead Island 2', amountMinor: 13059, currency: 'TRY', status: 'Completed' },
            { stableOrderId: 'try-124', title: 'Cyberpunk 2077', amountMinor: 12450, currency: 'TRY', status: 'Completed' },
            { stableOrderId: 'try-7', title: 'The Telltale Batman Shadows Edition', amountMinor: 719, currency: 'TRY', status: 'Completed' },
            { stableOrderId: 'usd-224', title: 'Red Dead Online', amountMinor: 224, currency: 'USD', status: 'Completed' },
        ],
    };
    sandbox.window.setVaultEpicPriceMode('purchase');
    const purchaseMap = sandbox.window._vaultBuildPurchaseMap(account);
    const cards = sandbox.window._vaultPrepareLibraryGames(account, purchaseMap);
    assert.equal(cards.length, 5);
    assert.ok(cards.every((card) => card.__vaultMatchedGame === null));
    const context = sandbox.window._vaultCreateEpicRenderContext(account);
    assert.doesNotThrow(() => sandbox.window._vaultLibraryResultsHtml(account, purchaseMap, cards, [], context));
    const html = sandbox.window._vaultLibraryResultsHtml(account, purchaseMap, cards, [], context);
    assert.equal((html.match(/vault-epic-cover-card/g) || []).length, 5);
    assert.match(html, /TRY 460\.46/);
    assert.match(html, /USD 2\.24/);
    assert.match(html, /vault-epic-cover-fallback/);
});

test('Epic Vault artwork lookup builds an index once instead of scanning pools per card', () => {
    const source = sidebar;
    assert.match(source, /function _vaultBuildArtworkIndex/);
    assert.match(source, /byStrongKey = new Map/);
    assert.match(source, /byExactTitle = new Map/);
    assert.match(source, /__vaultArtworkIndexCache/);
    const finder = extractByName(sidebar, '_vaultFindAllGamesArtworkForEpic');
    assert.match(finder, /index\.byStrongKey\.get/);
    assert.match(finder, /index\.byExactTitle/);
    assert.doesNotMatch(finder, /for \(const pool of pools\)[\s\S]*for \(const candidate of pool\)/);
});

test('Epic Vault large library uses the shared virtual grid controller instead of chunking all cards', () => {
    const render = extractByName(sidebar, '_renderVaultEpicLibraryResults');
    const mount = extractByName(sidebar, '_vaultMountLibraryVirtual');
    const frame = extractByName(sidebar, '_vaultRenderLibraryVirtualFrame');
    assert.match(dashboard, /virtual-grid-controller\.js/);
    assert.match(sidebar, /BaddelVirtualGridController/);
    assert.match(sidebar, /const __vaultLibraryVirtual/);
    assert.match(sidebar, /VAULT_LIBRARY_BUFFER_ROWS/);
    assert.match(render, /_vaultMountLibraryVirtual/);
    assert.match(mount, /controller\.mount/);
    assert.match(frame, /controller\.render\(force\)/);
    assert.doesNotMatch(frame, /window\._vs/);
    assert.doesNotMatch(render, /visibleGames\.map\([\s\S]*\.join\(''\)/);
});
test('Epic Vault Purchase History uses a Vault virtual list', () => {
    const render = extractByName(sidebar, '_renderVaultEpicHistoryResults');
    const frame = extractByName(sidebar, '_vaultRenderHistoryVirtualFrame');
    assert.match(sidebar, /const __vaultHistoryVirtual/);
    assert.match(sidebar, /VAULT_HISTORY_BUFFER_ROWS/);
    assert.match(render, /_vaultMountHistoryVirtual/);
    const mount = extractByName(sidebar, '_vaultMountHistoryVirtual');
    const ensure = extractByName(sidebar, '_vaultEnsureHistoryController');
    assert.match(ensure, /layout:\s*'list'/);
    assert.match(ensure, /_vaultHistoryStableId\(item, index\)/);
    assert.match(mount, /controller\.setItems|controller\.mount/);
    assert.doesNotMatch(frame, /window\._vs/);
});


test('Epic Vault virtualization is isolated from All Games _vs and uses mainContentArea', () => {
    assert.match(sidebar, /const __vaultLibraryVirtual/);
    assert.match(sidebar, /const __vaultHistoryVirtual/);
    assert.match(extractByName(sidebar, '_vaultVirtualScroller'), /mainContentArea/);
    const vaultVirtualSource = [
        extractByName(sidebar, '_vaultRenderLibraryVirtualFrame'),
        extractByName(sidebar, '_vaultRenderHistoryVirtualFrame'),
        extractByName(sidebar, '_vaultMountLibraryVirtual'),
        extractByName(sidebar, '_vaultMountHistoryVirtual'),
    ].join('\n');
    assert.doesNotMatch(vaultVirtualSource, /window\._vs|_vsRender|allGamesGrid/);
});

test('Epic Vault uses the existing main-process local cache owner and no second artwork cache', () => {
    const relevant = [
        extractByName(sidebar, '_vaultPrimeLocalCovers'),
        extractByName(sidebar, '_vaultPatchMountedCover'),
        extractByName(sidebar, '_vaultCoverCandidatesForGame'),
    ].join('\n');
    assert.doesNotMatch(relevant, /ContentAddressedArtworkCache|ArtworkDownloadManager|artwork-cache-v2|image_cache|mkdir|writeFile|fetch\(/i);
    assert.match(relevant, /getCachedImagesBulk/);
    assert.doesNotMatch(relevant, /cacheImage|cacheAllAssets|_agWarmCachedCoversForGames/);
});
test('Epic Vault remote cover candidates remain data only and do not trigger cache warm on open or scroll', () => {
    const { sandbox } = createVaultRuntimeSandbox();
    const remoteOnly = { title: 'Remote Only', coverUrl: 'https://cdn.example/remote.jpg' };
    assert.equal(sandbox.window._vaultHasLocalCoverCandidate(remoteOnly, null), false);
    assert.match(sandbox.window._vaultRenderEpicCover(remoteOnly), /vault-epic-cover-fallback/);
    assert.doesNotMatch(sandbox.window._vaultRenderEpicCover(remoteOnly), /https:\/\/cdn\.example/);
    const warm = extractByName(sidebar, '_vaultQueueAllGamesCoverWarm');
    assert.doesNotMatch(warm, /_agWarmCachedCoversForGames|cacheImage|cacheAllAssets|boostColdCoverBootstrap/);
});
test('Vault CSS keeps mainContentArea as the vertical scroll owner', () => {
    const vaultPageRules = [...css.matchAll(/#vaultView \.vault-page\s*\{[\s\S]*?\}/g)].map((m) => m[0]).join('\n');
    assert.doesNotMatch(vaultPageRules, /overflow-y:\s*auto/);
    assert.match(vaultPageRules, /overflow-y:\s*visible/);
    assert.match(css, /\.vault-virtual-grid/);
    assert.match(css, /\.vault-virtual-history/);
});

test('Epic Vault controls avoid full account rerender and search is debounced', () => {
    const libSort = extractByName(sidebar, 'setVaultEpicLibrarySort');
    const libFilter = extractByName(sidebar, 'setVaultEpicLibraryFilter');
    const libSearch = extractByName(sidebar, 'setVaultEpicLibrarySearch');
    const histSort = extractByName(sidebar, 'setVaultEpicHistorySort');
    const histFilter = extractByName(sidebar, 'setVaultEpicHistoryFilter');
    assert.doesNotMatch(`${libSort}\n${libFilter}\n${libSearch}\n${histSort}\n${histFilter}`, /_renderVaultEpicFromCache/);
    assert.match(libSearch, /setTimeout/);
    assert.match(libSearch, /120/);
});


test('Epic Vault canonical identity dedupes logical games before offer variants', () => {
    const platformKey = extractByName(platformSync, 'getEpicVaultCanonicalGameKey');
    const platformDedupe = extractByName(platformSync, 'dedupeEpicVaultGameRows');
    const rendererKey = extractByName(sidebar, '_vaultCanonicalGameKey');
    const rendererDedupe = extractByName(sidebar, '_vaultDedupeLibraryGames');
    for (const fn of [platformKey, rendererKey]) {
        const catalogIndex = fn.indexOf('namespace && catalogItemId');
        const offerIndex = fn.indexOf('offerId ?');
        assert.ok(catalogIndex > -1 && offerIndex > catalogIndex, 'catalog identity should win before offer fallback');
        assert.match(fn, /namespace && appName/);
    }
    assert.match(platformDedupe, /mergeEpicVaultGameRow/);
    assert.match(rendererDedupe, /canonicalGameId/);
    assert.doesNotMatch(rendererDedupe, /_vaultMergeGameDuplicate|_vaultCanMergeByTitle/);
    assert.match(platformSync, /sanitizeEpicVaultAccount/);
    assert.match(platformSync, /mergeEpicVaultAccount\(sanitizeEpicVaultAccount\(accountVault\)\)/);
    assert.match(platformSyncRepository, /function sanitizeEpicVaultCache/);
    assert.match(platformSyncRepository, /readEpicVault\(\)[\s\S]*sanitizeEpicVaultCache/);
    assert.match(platformSyncRepository, /writeEpicVault\(vault\)[\s\S]*sanitizeEpicVaultCache/);
});

test('Epic Vault runtime drops duplicate offer cards for one catalog game', () => {
    const { sandbox } = createVaultRuntimeSandbox();
    const account = { games: [
        { canonicalGameId: 'epic:limbo', title: 'Limbo', namespace: 'limbo-ns', catalogItemId: 'limbo-catalog', offerId: 'offer-a', coverUrl: 'a.webp', priceStatus: 'priced', livePrice: { amount: 20000, currency: 'TRY', priceStatus: 'priced' } },
        { canonicalGameId: 'epic:limbo', title: 'Limbo', namespace: 'limbo-ns', catalogItemId: 'limbo-catalog', offerId: 'offer-b', coverUrl: 'b.webp', priceStatus: 'unresolved' },
        { canonicalGameId: 'epic:limbo-soundtrack', title: 'Limbo Soundtrack', namespace: 'limbo-ns', catalogItemId: 'soundtrack-catalog', offerId: 'offer-c', priceStatus: 'priced', livePrice: { amount: 9000, currency: 'TRY', priceStatus: 'priced' } },
    ] };
    const unique = sandbox.window._vaultDedupeLibraryGames(account.games);
    assert.equal(unique.length, 2);
    assert.deepEqual(unique.map((game) => game.title), ['Limbo', 'Limbo Soundtrack']);
    assert.equal(unique[0].canonicalGameId, 'epic:limbo');
    const visible = sandbox.window._vaultPrepareLibraryGames(account, new Map());
    assert.equal(visible.filter((game) => game.title === 'Limbo').length, 1);
});

test('Epic Vault sticky controls and scroll-to-top use the Vault scroll owner', () => {
    const detail = extractByName(sidebar, '_renderVaultEpicAccountDetail');
    const bind = extractByName(sidebar, 'bindVaultBackToTop');
    const scroll = extractByName(sidebar, 'scrollVaultToTop');
    assert.match(detail, /vault-epic-sticky-panel/);
    assert.match(css, /#vaultView \.vault-epic-sticky-panel\s*\{[\s\S]*position:\s*sticky[\s\S]*top:\s*0/);
    assert.match(css, /#vaultView \.vault-library-toolbar,[\s\S]*position:\s*sticky/);
    assert.match(dashboard, /id="vaultBackToTop"/);
    assert.match(bind, /_vaultVirtualScroller\(\)/);
    assert.match(bind, /removeEventListener/);
    assert.match(bind, /addEventListener\?\.\('scroll'/);
    assert.match(scroll, /scrollTo\(\{ top: 0, behavior: 'smooth' \}\)/);
    assert.match(extractByName(sidebar, '_vaultVirtualScroller'), /mainContentArea/);
});

test('Epic Vault cover completion patches mounted cards without a full grid rerender loop', () => {
    const patch = extractByName(sidebar, '_vaultPatchMountedCover');
    const batch = extractByName(sidebar, '_vaultPatchReadyArtworkBatch');
    assert.match(patch, /controller\.patch/);
    assert.match(batch, /_vaultPrimeLocalCovers\(matches, account\)/);
    assert.doesNotMatch(`${patch}\n${batch}`, /_renderVaultEpicLibraryResults|_renderVaultEpicFromCache|innerHTML\s*=\s*_vaultLibraryCardsHtml/);
});
test('Epic Vault cover resolution reuses canonical All Games artwork by strong identity', () => {
    const { sandbox } = createVaultRuntimeSandbox();
    sandbox.window._allGamesCache = [{
        title: 'Red Dead Online',
        namespace: 'rdo-ns',
        offerId: 'rdo-offer',
        image: 'file://all-games-rdo.webp',
    }];
    sandbox.window._agResolveAllGamesCoverDecision = (game) => ({ value: game.image, source: 'resolver-test' });
    const html = sandbox.window._vaultRenderEpicCover({
        title: 'Receipt Row',
        namespace: 'rdo-ns',
        offerId: 'rdo-offer',
        __vaultPurchase: { title: 'Red Dead Online', namespace: 'rdo-ns', offerId: 'rdo-offer' },
    });
    assert.match(html, /file:\/\/all-games-rdo\.webp/);
    assert.doesNotMatch(html, /vault-epic-cover-fallback/);
});

test('Epic Vault cover failure is not permanently filtered when candidates are rebuilt', () => {
    const { sandbox } = createVaultRuntimeSandbox();
    const candidates = encodeURIComponent(JSON.stringify(['https://temporary.example/cover.webp']));
    const img = {
        dataset: { coverKey: 'temporary-cover', coverIndex: '0', coverCandidates: candidates },
        src: 'https://temporary.example/cover.webp',
        outerHTML: '',
        getAttribute(name) { return name === 'src' ? this.src : null; },
        closest() { return null; },
    };
    sandbox.window.handleVaultEpicCoverError(img);
    const rebuilt = sandbox.window._vaultCoverCandidatesForGame({ title: 'Temporary Cover', coverUrl: 'https://temporary.example/cover.webp' });
    assert.equal(rebuilt[0].url, 'https://temporary.example/cover.webp');
});

test('Epic Vault History All equals category union and keeps paid USD above free rows', () => {
    const { sandbox } = createVaultRuntimeSandbox();
    const account = {
        purchaseHistoryItems: [
            { stableOrderId: 'try-460', title: 'Cyberpunk 2077: Phantom Liberty', amountMinor: 46046, currency: 'TRY', status: 'Completed' },
            { stableOrderId: 'try-130', title: 'Dead Island 2', amountMinor: 13059, currency: 'TRY', status: 'Completed' },
            { stableOrderId: 'try-124', title: 'Cyberpunk 2077', amountMinor: 12450, currency: 'TRY', status: 'Completed' },
            { stableOrderId: 'try-7', title: 'The Telltale Batman Shadows Edition', amountMinor: 719, currency: 'TRY', status: 'Completed' },
            { stableOrderId: 'usd-224', title: 'Red Dead Online', amountMinor: 224, currency: 'USD', status: 'Completed' },
            { stableOrderId: 'free-1', title: 'Free Claim A', amountMinor: 0, currency: 'TRY', status: 'Completed' },
            { stableOrderId: 'free-2', title: 'Free Claim B', amountMinor: 0, currency: 'TRY', status: 'Completed' },
            { stableOrderId: 'fab-1', title: 'Fab Asset', amountMinor: 0, currency: 'TRY', status: 'Completed', isFab: true },
            { stableOrderId: 'refund-1', title: 'Refund Row', amountMinor: -500, currency: 'TRY', status: 'Refunded', isRefund: true },
        ],
    };
    const setFilter = (filter) => { sandbox.window.setVaultEpicHistoryFilter(filter); return sandbox.window._vaultPrepareHistoryItems(account).map(sandbox.window._vaultHistoryStableId); };
    const all = setFilter('all');
    const union = new Set([...setFilter('paid'), ...setFilter('refunds'), ...setFilter('free'), ...setFilter('fab')]);
    assert.deepEqual(new Set(all), union);
    assert.equal(all.length, union.size);
    assert.ok(all.includes('usd-224'));
    assert.ok(all.indexOf('usd-224') < all.indexOf('free-1'));
});


test('Epic Purchase History rows render only cached local artwork thumbnails without changing ledger fields', () => {
    const { sandbox } = createVaultRuntimeSandbox();
    const item = {
        title: 'Cyberpunk 2077: Phantom Liberty',
        coverUrl: 'file://phantom-cover.webp',
        coverCandidates: [{ url: 'https://cdn1.epicgames.com/phantom-alt.jpg', source: 'epic_catalog' }],
        amountMinor: 46046,
        currency: 'TRY',
        status: 'PURCHASE',
        itemCount: 2,
    };
    const html = sandbox.window._vaultRenderHistoryArtwork(item);
    assert.match(html, /vault-history-cover/);
    assert.match(html, /vault-history-cover-img/);
    assert.match(html, /file:\/\/phantom-cover\.webp/);
    assert.doesNotMatch(html, /https:\/\/cdn1\.epicgames\.com/);
    assert.match(html, /loading="lazy"/);
    assert.match(html, /decoding="async"/);
    assert.doesNotMatch(html, /data-cover-candidates=/);

    const row = extractByName(sidebar, '_vaultHistoryRowHtml');
    assert.match(row, /_vaultRenderHistoryArtwork\(item, account\)/);
    assert.match(row, /_vaultHistoryAmountLabel\(item, account\)/);
    assert.match(row, /item\.itemCount > 1/);
});
test('Epic Purchase History artwork falls back to title initial without catalog calls', () => {
    const { sandbox } = createVaultRuntimeSandbox();
    const fallback = sandbox.window._vaultRenderHistoryArtwork({ title: 'Red Dead Online' });
    assert.match(fallback, /vault-history-cover-fallback/);
    assert.match(fallback, />R</);
    const row = extractByName(sidebar, '_vaultHistoryRowHtml');
    assert.doesNotMatch(row, /Catalog|fetchEpic|platformSync|graphql|resolveEpic/i);
});

test('Epic Purchase History cover candidates prefer coverUrl then cached candidates', () => {
    const { sandbox } = createVaultRuntimeSandbox();
    const candidates = sandbox.window._vaultHistoryArtworkCandidates({
        title: 'Batman',
        coverUrl: 'https://example.test/primary.jpg',
        coverCandidates: [
            { url: 'https://example.test/primary.jpg', source: 'duplicate' },
            { url: 'https://example.test/secondary.jpg', source: 'epic_catalog' },
        ],
        image: 'https://example.test/legacy.jpg',
    });
    assert.deepEqual(candidates.map((item) => item.url), [
        'https://example.test/primary.jpg',
        'https://example.test/secondary.jpg',
        'https://example.test/legacy.jpg',
    ]);
});

test('Epic Purchase History thumbnail CSS stays compact and portrait-shaped', () => {
    assert.match(css, /grid-template-columns:\s*108px 52px minmax\(0, 1fr\) minmax\(112px, auto\)/);
    assert.match(css, /\.vault-history-cover\s*\{[\s\S]*width:\s*52px;[\s\S]*height:\s*70px;/);
    assert.match(css, /\.vault-history-cover-img\s*\{[\s\S]*object-fit:\s*cover;/);
});

test('Epic Vault Purchase History toolbar renders canonical fetched timestamp and refresh path', () => {
    const fetched = extractByName(sidebar, '_vaultHistoryFetchedAt');
    const status = extractByName(sidebar, '_vaultHistoryLastUpdatedLabel');
    const refresh = extractByName(sidebar, 'refreshVaultEpicPurchaseHistory');
    const toolbar = extractByName(sidebar, '_vaultHistoryToolbarHtml');
    assert.match(fetched, /purchaseHistoryFetchedAt/);
    assert.match(fetched, /purchaseHistory\?\.fetchedAt/);
    assert.match(toolbar, /Last updated:/);
    assert.match(toolbar, /refreshVaultEpicPurchaseHistory/);
    assert.match(refresh, /platformSyncRefreshEpicPurchaseHistory/);
    assert.match(refresh, /await window\.electronAPI/);
    assert.doesNotMatch(refresh, /platformSyncSync|platformSyncLink|openEpicLoginWindow|runLegendary/);
    assert.doesNotMatch(refresh, /box\.innerHTML\s*=\s*'<div class="vault-empty-state"><span>Refreshing/);
});

test('Epic Vault overflow fix is scoped to Vault containers only', () => {
    const tail = css.slice(css.lastIndexOf('Epic Vault fix pass'));
    assert.match(tail, /#vaultView/);
    assert.match(tail, /overflow-x:\s*clip/);
    assert.match(tail, /min-width:\s*0/);
    assert.doesNotMatch(tail, /body\s*\{[^}]*overflow-x:\s*hidden/s);
});

test('Epic Vault filters and sorts use custom dark dropdowns instead of native selects', () => {
    const libraryToolbar = extractByName(sidebar, '_vaultLibraryToolbarHtml');
    const historyToolbar = extractByName(sidebar, '_vaultHistoryToolbarHtml');
    const dropdown = extractByName(sidebar, '_vaultDropdownHtml');
    assert.doesNotMatch(`${libraryToolbar}\n${historyToolbar}`, /<select/i);
    assert.match(`${libraryToolbar}\n${historyToolbar}`, /_vaultDropdownHtml/);
    assert.match(dropdown, /data-vault-dropdown/);
    assert.match(dropdown, /role="listbox"/);
});

test('Epic Vault search updates results without replacing the focused search input', () => {
    const librarySearch = extractByName(sidebar, 'setVaultEpicLibrarySearch');
    const historySearch = extractByName(sidebar, 'setVaultEpicHistorySearch');
    assert.match(librarySearch, /_renderVaultEpicLibraryResults/);
    assert.match(historySearch, /_renderVaultEpicHistoryResults/);
    assert.doesNotMatch(`${librarySearch}\n${historySearch}`, /_renderVaultEpicFromCache/);
});

test('Purchase History defaults amount high-to-low safely within currency groups and filters', () => {
    const { sandbox } = createVaultRuntimeSandbox();
    const account = { purchaseHistoryItems: [
        { title: 'USD Small', amountMinor: 1200, amount: 12, currency: 'USD', status: 'Completed' },
        { title: 'TRY Large Number', amountMinor: 143000, amount: 1430, currency: 'TRY', status: 'Completed' },
        { title: 'USD Big', amountMinor: 12000, amount: 120, currency: 'USD', status: 'Completed' },
        { title: 'Refund Row', amountMinor: 999, amount: 9.99, currency: 'USD', isRefund: true, status: 'Refunded' },
        { title: 'Free Row', amountMinor: 0, amount: 0, currency: 'USD', status: 'Completed' },
        { title: 'Fab Row', amountMinor: 5000, amount: 50, currency: 'USD', isFab: true, status: 'Completed' },
    ] };
    let visible = sandbox.window._vaultPrepareHistoryItems(account);
    assert.deepEqual(visible.map((item) => item.title), ['TRY Large Number', 'USD Big', 'Fab Row', 'USD Small', 'Refund Row', 'Free Row']);
    sandbox.window.setVaultEpicHistoryCurrency('USD');
    visible = sandbox.window._vaultPrepareHistoryItems(account);
    assert.deepEqual(visible.map((item) => item.title), ['USD Big', 'Fab Row', 'USD Small', 'Refund Row', 'Free Row']);
    sandbox.window.setVaultEpicHistoryFilter('paid');
    assert.deepEqual(sandbox.window._vaultPrepareHistoryItems(account).map((item) => item.title), ['USD Big', 'USD Small']);
    sandbox.window.setVaultEpicHistoryFilter('refunds');
    assert.deepEqual(sandbox.window._vaultPrepareHistoryItems(account).map((item) => item.title), ['Refund Row']);
    sandbox.window.setVaultEpicHistoryFilter('free');
    assert.deepEqual(sandbox.window._vaultPrepareHistoryItems(account).map((item) => item.title), ['Free Row']);
    sandbox.window.setVaultEpicHistoryFilter('fab');
    assert.deepEqual(sandbox.window._vaultPrepareHistoryItems(account).map((item) => item.title), ['Fab Row']);
    sandbox.window.setVaultEpicHistorySearch('fab');
    assert.deepEqual(sandbox.window._vaultPrepareHistoryItems(account).map((item) => item.title), ['Fab Row']);
});

test('Vault runtime click path opens Epic, selects account, and backs out without missing helper errors', async () => {
    const { sandbox, calls, grid, epicCard, vaultPage } = createVaultRuntimeSandbox();

    assert.equal(typeof sandbox.window._setVaultState, 'function');
    assert.equal(typeof sandbox.window._vaultSpendLabel, 'function');

    sandbox.window.openVaultPlatform('overview');
    assert.equal(vaultPage.dataset.vaultState, 'overview');
    assert.equal(vaultPage.dataset.vaultPlatform, undefined);

    assert.doesNotThrow(() => grid.dispatchEvent({ type: 'click', target: epicCard, preventDefault() {} }));
    assert.equal(vaultPage.dataset.vaultState, 'platform');
    assert.equal(vaultPage.dataset.vaultPlatform, 'epic');
    await Promise.resolve();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.hydrate, 1);

    assert.doesNotThrow(() => sandbox.window.selectVaultEpicAccount('epic-account-b'));
    assert.equal(vaultPage.dataset.vaultState, 'account');
    assert.equal(vaultPage.dataset.vaultPlatform, 'epic');

    assert.doesNotThrow(() => sandbox.window.backToVaultEpicAccounts());
    assert.equal(vaultPage.dataset.vaultState, 'platform');
    assert.equal(vaultPage.dataset.vaultPlatform, 'epic');

    assert.doesNotThrow(() => sandbox.window.backToVaultPlatforms());
    assert.equal(vaultPage.dataset.vaultState, 'overview');
    assert.equal(vaultPage.dataset.vaultPlatform, undefined);
    assert.equal(calls.auth, 0);
    assert.equal(calls.sync, 0);
    assert.deepEqual(calls.errors, []);
});

test('Vault spend labels keep multi-currency spend separate', () => {
    const { sandbox } = createVaultRuntimeSandbox();
    const account = {
        permissions: { purchaseHistory: true },
        multipleCurrencies: true,
        currency: 'MULTI',
        grossPurchasesByCurrency: { USD: 90000, EUR: 21000 },
        refundsByCurrency: { USD: 5000 },
        netSpentByCurrency: { USD: 85000, EUR: 21000 },
    };
    const gross = sandbox.window._vaultSpendLabel(account, 'grossPurchasesMinor');
    const net = sandbox.window._vaultActualSpentLabel(account);
    assert.match(gross, /USD 900\.00/);
    assert.match(gross, /210\.00/);
    assert.doesNotMatch(gross, /MULTI/);
    assert.match(net, /USD 850\.00/);
    assert.match(net, /210\.00/);
    assert.doesNotMatch(net, /MULTI/);
});

test('Epic Vault background refresh uses coalesced preserve-scroll path instead of loading rerender', () => {
    const invalidate = extractByName(sidebar, 'invalidateEpicVaultCache');
    const schedule = extractByName(sidebar, '_vaultScheduleEpicVaultRefresh');
    const hydrate = extractByName(sidebar, 'hydrateEpicVaultConsole');
    const render = extractByName(sidebar, '_renderVaultEpicAccountDetail');
    assert.match(invalidate, /preserveScroll:\s*options\.preserveScroll !== false/);
    assert.match(schedule, /__vaultEpicRefreshPromise/);
    assert.match(schedule, /background\|sync\|committed\|library\|metadata\|artwork\|snapshot\|invalidation/);
    assert.match(hydrate, /preserveAnchor/);
    assert.match(hydrate, /refreshSeq !== __vaultEpicRefreshSeq/);
    assert.match(hydrate, /expectedAccountId !== __vaultSelectedEpicAccountId/);
    assert.match(render, /options\.preserveScroll/);
    assert.match(render, /_vaultPatchEpicAccountShell\(account\)/);
});

test('Epic Vault account view has one compact sticky controls wrapper outside virtual results', () => {
    const detail = extractByName(sidebar, '_renderVaultEpicAccountDetail');
    const library = extractByName(sidebar, '_renderVaultEpicLibrary');
    const history = extractByName(sidebar, '_renderVaultEpicHistory');
    assert.equal((detail.match(/vault-epic-sticky-panel/g) || []).length, 1);
    assert.ok(detail.indexOf('vaultEpicStickyControls') < detail.indexOf('vaultEpicAccountContent'));
    assert.match(library, /_vaultSetStickyControlsHtml/);
    assert.match(history, /_vaultSetStickyControlsHtml/);
    assert.doesNotMatch(library, /box\.innerHTML = `\$\{_vaultLibraryToolbarHtml/);
    assert.doesNotMatch(history, /box\.innerHTML = `\$\{_vaultHistoryToolbarHtml/);
});

test('Epic Vault sticky CSS uses one solid wrapper and no nested sticky toolbar offsets', () => {
    const sticky = css.slice(css.indexOf('Epic Vault production UX: one compact sticky account toolbar'));
    assert.match(sticky, /#vaultView \.vault-epic-sticky-panel\s*\{[\s\S]*position:\s*sticky/);
    assert.match(sticky, /background:\s*#080a08/);
    assert.match(sticky, /overflow:\s*visible/);
    assert.doesNotMatch(sticky, /top:\s*238px|top:\s*286px/);
    assert.match(sticky, /\.vault-epic-sticky-panel \.vault-library-toolbar,[\s\S]*position:\s*relative/);
    assert.match(sticky, /backdrop-filter:\s*none/);
});

test('Current price filter defaults to Priced and keeps All as explicit local state', () => {
    const { sandbox } = createVaultRuntimeSandbox();
    const account = { games: [
        { title: 'Paid', priceStatus: 'priced', livePrice: { amount: 1000, currency: 'USD', priceResolved: true } },
        { title: 'Sale', priceStatus: 'priced', livePrice: { amount: 500, originalAmount: 1000, discountPercent: 50, isDiscounted: true, currency: 'USD', priceResolved: true } },
        { title: 'Free', priceStatus: 'free', livePrice: { amount: 0, currency: 'USD', priceResolved: true } },
        { title: 'Unavailable', priceStatus: 'not_for_sale' },
        { title: 'Unresolved', priceStatus: 'unresolved' },
    ] };
    assert.deepEqual(sandbox.window._vaultPrepareLibraryGames(account, new Map()).map((game) => game.title), ['Paid', 'Sale']);
    sandbox.window.setVaultEpicLibraryFilter('all');
    assert.deepEqual(sandbox.window._vaultPrepareLibraryGames(account, new Map()).map((game) => game.title), ['Paid', 'Sale', 'Free', 'Unavailable', 'Unresolved']);
    sandbox.window.setVaultEpicPriceMode('purchase');
    sandbox.window.setVaultEpicPriceMode('current');
    assert.deepEqual(sandbox.window._vaultPrepareLibraryGames(account, new Map()).map((game) => game.title), ['Paid', 'Sale', 'Free', 'Unavailable', 'Unresolved']);
});

test('Current price filters classify priced free sale and unavailable without changing valuation source', () => {
    const { sandbox } = createVaultRuntimeSandbox();
    const account = { games: [
        { title: 'Paid', priceStatus: 'priced', livePrice: { amount: 1000, currency: 'USD', priceResolved: true } },
        { title: 'Sale', priceStatus: 'priced', livePrice: { amount: 500, originalAmount: 1000, discountPercent: 50, isDiscounted: true, currency: 'USD', priceResolved: true } },
        { title: 'Free', priceStatus: 'free', livePrice: { amount: 0, currency: 'USD', priceResolved: true } },
        { title: 'Unavailable', priceStatus: 'not_for_sale' },
        { title: 'Unresolved', priceStatus: 'unresolved' },
    ] };
    const names = () => sandbox.window._vaultPrepareLibraryGames(account, new Map()).map((game) => game.title);
    sandbox.window.setVaultEpicLibraryFilter('priced');
    assert.deepEqual(names(), ['Paid', 'Sale']);
    sandbox.window.setVaultEpicLibraryFilter('free');
    assert.deepEqual(names(), ['Free']);
    sandbox.window.setVaultEpicLibraryFilter('sale');
    assert.deepEqual(names(), ['Sale']);
    sandbox.window.setVaultEpicLibraryFilter('unavailable');
    assert.deepEqual(names(), ['Unavailable', 'Unresolved']);
    const coverage = sandbox.window._vaultEpicCoverage(account);
    assert.equal(coverage.currentValueMinor, 1500);
});

test('Epic Vault Free to All with High to Low recomputes from base and puts priced before free', () => {
    const { sandbox } = createVaultRuntimeSandbox();
    const account = { games: [
        { title: 'Free A', namespace: 'ns', catalogItemId: 'free-a', priceStatus: 'free', livePrice: { amount: 0, currency: 'USD', priceResolved: true } },
        { title: 'Paid Low', namespace: 'ns', catalogItemId: 'paid-low', priceStatus: 'priced', livePrice: { amount: 1000, currency: 'USD', priceResolved: true } },
        { title: 'Unavailable', namespace: 'ns', catalogItemId: 'gone', priceStatus: 'not_for_sale' },
        { title: 'Paid High', namespace: 'ns', catalogItemId: 'paid-high', priceStatus: 'priced', livePrice: { amount: 5000, currency: 'USD', priceResolved: true } },
    ] };
    sandbox.window.setVaultEpicPriceMode('current');
    sandbox.window.setVaultEpicLibraryFilter('free');
    assert.deepEqual(sandbox.window._vaultPrepareLibraryGames(account, new Map()).map((game) => game.title), ['Free A']);
    sandbox.window.setVaultEpicLibraryFilter('all');
    const names = sandbox.window._vaultPrepareLibraryGames(account, new Map()).map((game) => game.title);
    assert.deepEqual(names, ['Paid High', 'Paid Low', 'Free A', 'Unavailable']);
});

test('Epic Vault guarded dedupe collapses duplicate Control but keeps editions and DLC separate', () => {
    const { sandbox } = createVaultRuntimeSandbox();
    const games = [
        { canonicalGameId: 'epic:control', title: 'Control', namespace: 'control-ns', catalogItemId: 'catalog-a', offerId: 'offer-a', coverUrl: 'file://control.webp', priceStatus: 'priced', livePrice: { amount: 2999, currency: 'USD', priceResolved: true } },
        { canonicalGameId: 'epic:control', title: 'Control', namespace: 'control-ns', catalogItemId: 'catalog-b', offerId: 'offer-b', coverUrl: 'file://control.webp', priceStatus: 'priced', livePrice: { amount: 2999, currency: 'USD', priceResolved: true } },
        { canonicalGameId: 'epic:control-ultimate', title: 'Control Ultimate Edition', namespace: 'control-ns', catalogItemId: 'catalog-ultimate', offerId: 'offer-c', coverUrl: 'file://control-ultimate.webp', priceStatus: 'priced', livePrice: { amount: 3999, currency: 'USD', priceResolved: true } },
        { canonicalGameId: 'epic:control-dlc', title: 'Control DLC Pack', namespace: 'control-ns', catalogItemId: 'catalog-dlc', offerId: 'offer-d', productType: 'DLC', coverUrl: 'file://control-dlc.webp', priceStatus: 'priced', livePrice: { amount: 999, currency: 'USD', priceResolved: true } },
    ];
    const deduped = sandbox.window._vaultDedupeLibraryGames(games);
    assert.equal(deduped.filter((game) => game.title === 'Control').length, 1);
    assert.ok(deduped.some((game) => game.title === 'Control Ultimate Edition'));
    assert.ok(deduped.some((game) => game.title === 'Control DLC Pack'));
    assert.equal(deduped.length, 3);
});

test('Epic Vault user result changes use results-start rather than preserve-anchor', () => {
    const sortFn = extractByName(sidebar, 'setVaultEpicLibrarySort');
    const filterFn = extractByName(sidebar, 'setVaultEpicLibraryFilter');
    const searchFn = extractByName(sidebar, 'setVaultEpicLibrarySearch');
    const historyFn = extractByName(sidebar, 'setVaultEpicHistoryFilter');
    assert.match(sortFn, /scrollPolicy:\s*'results-start'/);
    assert.match(filterFn, /scrollPolicy:\s*'results-start'/);
    assert.match(searchFn, /scrollPolicy:\s*'results-start'/);
    assert.match(historyFn, /scrollPolicy:\s*'results-start'/);
});

test('Epic Vault CSS removes account rail decoration and keeps child controls non-sticky', () => {
    assert.match(css, /vault-page:has\(\.vault-epic-detail\)::after[\s\S]*display:\s*none/);
    assert.match(css, /#vaultView \.vault-price-line,[\s\S]*position:\s*relative !important/);
    assert.doesNotMatch(css.slice(css.lastIndexOf('Epic Vault runtime corrections')), /top:\s*238px|top:\s*286px/);
});
test('Epic Vault protected build bundles shared virtual-grid controller before sidebar', () => {
  const buildProtected = fs.readFileSync(path.join(ROOT, 'scripts', 'build-protected.js'), 'utf8');
  const controllerIndex = buildProtected.indexOf("S('src/js/app/virtual-grid-controller.js')");
  const sidebarIndex = buildProtected.indexOf("S('src/js/app/sidebar.js')");
  assert.notEqual(controllerIndex, -1, 'virtual-grid controller missing from protected renderer bundle');
  assert.notEqual(sidebarIndex, -1, 'sidebar missing from protected renderer bundle');
  assert.ok(controllerIndex < sidebarIndex, 'virtual-grid controller must load before sidebar in protected build');
});

test('Epic Purchase History artwork resolves through strong Epic identity and keeps rows separate', () => {
    const { sandbox } = createVaultRuntimeSandbox();
    const account = { accountId: 'acct-a', games: [
        { title: 'Red Dead Redemption 2', namespace: 'rdr2-ns', catalogItemId: 'rdr2-cat', appName: 'Heather', coverUrl: 'file://rdr2-cover.webp' },
    ] };
    const context = sandbox.window._vaultCreateEpicRenderContext(account);
    const purchase = { title: 'Red Dead Redemption 2', namespace: 'rdr2-ns', catalogItemId: 'rdr2-cat', orderId: 'buy-1', amountMinor: 1999, currency: 'USD' };
    const refund = { title: 'Red Dead Redemption 2', namespace: 'rdr2-ns', catalogItemId: 'rdr2-cat', orderId: 'refund-1', amountMinor: -1999, currency: 'USD', isRefund: true };

    const purchaseSubject = sandbox.window._vaultHistoryArtworkSubject(purchase, context);
    const refundSubject = sandbox.window._vaultHistoryArtworkSubject(refund, context);

    assert.equal(purchaseSubject.title, 'Red Dead Redemption 2');
    assert.equal(refundSubject.title, 'Red Dead Redemption 2');
    assert.equal(sandbox.window._vaultCanonicalGameKey(purchaseSubject), sandbox.window._vaultCanonicalGameKey(refundSubject));
    assert.notEqual(sandbox.window._vaultHistoryStableId(purchase), sandbox.window._vaultHistoryStableId(refund));
    assert.match(sandbox.window._vaultRenderHistoryArtwork(purchase, context), /file:\/\/rdr2-cover\.webp/);
    assert.match(sandbox.window._vaultRenderHistoryArtwork(refund, context), /file:\/\/rdr2-cover\.webp/);
});

test('Epic Purchase History artwork uses safe title fallback only when identities do not conflict', () => {
    const { sandbox } = createVaultRuntimeSandbox();
    const account = { accountId: 'acct-a', games: [
        { title: 'Tomb Raider GAME OF THE YEAR EDITION', namespace: 'tr-ns', catalogItemId: 'tr-cat', coverUrl: 'file://tomb.webp' },
        { title: 'Different Product', namespace: 'other-ns', catalogItemId: 'other-cat', coverUrl: 'file://other.webp' },
    ] };
    const context = sandbox.window._vaultCreateEpicRenderContext(account);
    const safe = sandbox.window._vaultHistoryArtworkSubject({ title: 'Tomb Raider GAME OF THE YEAR EDITION', orderId: 'order-safe' }, context);
    const conflict = sandbox.window._vaultHistoryArtworkSubject({ title: 'Tomb Raider GAME OF THE YEAR EDITION', namespace: 'other-ns', catalogItemId: 'other-cat', orderId: 'order-conflict' }, context);

    assert.equal(safe.catalogItemId, 'tr-cat');
    assert.equal(conflict.catalogItemId, 'other-cat');
});

test('Epic Purchase History artwork warms missing covers through shared bootstrap without remote DOM rendering', () => {
    const { sandbox } = createVaultRuntimeSandbox();
    const queued = [];
    sandbox.window.electronAPI.boostColdCoverBootstrap = async (games, opts) => { queued.push({ games, opts }); return { status: 'queued' }; };
    const account = { accountId: 'acct-a', games: [
        { title: 'Warm Me', namespace: 'warm-ns', catalogItemId: 'warm-cat', coverCandidates: [{ url: 'https://cdn.example/warm.jpg' }] },
    ] };
    const context = sandbox.window._vaultCreateEpicRenderContext(account);
    const subject = sandbox.window._vaultHistoryArtworkSubject({ title: 'Warm Me', namespace: 'warm-ns', catalogItemId: 'warm-cat', orderId: 'warm-order' }, context);

    assert.equal(sandbox.window._vaultQueueMissingCoverWarm([subject], context, 'test-history-warm'), 1);
    assert.equal(queued.length, 1);
    assert.equal(queued[0].opts.reason, 'test-history-warm');
    assert.equal(queued[0].opts.priority, 'prefetch');
    assert.match(sandbox.window._vaultRenderHistoryArtwork(subject, context), /vault-history-cover-fallback/);
    assert.doesNotMatch(sandbox.window._vaultRenderHistoryArtwork(subject, context), /https:\/\/cdn\.example/);
});

test('Epic Vault final overflow CSS clips only the Vault boundary and makes scrollbar corner transparent', () => {
    assert.ok(css.includes('#mainContentArea:has(#vaultView:not([style*="display: none"]))'));
    assert.ok(css.includes('overflow-x: clip'));
    assert.ok(css.includes('::-webkit-scrollbar-corner'));
    assert.ok(css.includes('#vaultView:not([style*="display: none"])'));
});

test('Epic Purchase History artwork includes legacy normalized title artwork aliases after strong identities', () => {
    const { sandbox } = createVaultRuntimeSandbox();
    const account = { accountId: 'acct-a', games: [] };
    const context = sandbox.window._vaultCreateEpicRenderContext(account);
    const subject = sandbox.window._vaultHistoryArtworkSubject({
        title: 'Red Dead Redemption 2',
        namespace: 'b30b6d1b4dfd4dcc93b5490be5e094e5',
        offerId: 'a3c78a5c62824677834c1008e0be9b2d',
        orderId: 'purchase-rdr2',
        coverCandidates: [{ url: 'https://cdn1.epicgames.com/epic/offer/rdr2.jpg' }],
    }, context);
    const aliases = sandbox.window._vaultArtworkAliasesForGame(subject, context);
    assert.ok(aliases.indexOf('ns:b30b6d1b4dfd4dcc93b5490be5e094e5:offer:a3c78a5c62824677834c1008e0be9b2d') >= 0);
    assert.ok(aliases.includes('Red_Dead_Redemption_2:cover'));
    assert.ok(aliases.indexOf('Red_Dead_Redemption_2:cover') > aliases.indexOf('offer:a3c78a5c62824677834c1008e0be9b2d'));
});

test('Vault overview hydrates the persisted reconciled snapshot and renders factual totals', async () => {
    const { sandbox, elements, calls } = createVaultRuntimeSandbox();
    sandbox.window.openVaultPlatform('overview');
    await Promise.resolve();
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(calls.hydrate, 1);
    assert.equal(elements.get('vaultOverviewTotalGames').textContent, '1');
    assert.equal(elements.get('vaultOverviewAccountsPlatforms').textContent, '1 / 1');
    assert.equal(elements.get('vaultEpicCardGames').textContent, '1');
    assert.match(elements.get('vaultEpicCardValue').textContent, /USD 59\.99/);
    assert.equal(calls.auth, 0);
    assert.equal(calls.sync, 0);
});

test('An open Vault overview refreshes when the Epic library phase commits without a prior cache', async () => {
    const { sandbox, elements, calls } = createVaultRuntimeSandbox();
    calls.vaultResponse = { vault: { accounts: [], generatedAt: '2026-09-07T00:00:00.000Z' } };
    sandbox.window.openVaultPlatform('overview');
    await Promise.resolve();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(elements.get('vaultOverviewAccountsPlatforms').textContent, '0 / 0');

    calls.vaultResponse = { vault: { generatedAt: '2026-09-07T00:01:00.000Z', accounts: [{
        accountId: 'new-account', vaultRevision: 1, currency: 'USD', permissions: {},
        games: [{ vaultCanonicalKey: 'epic:catalog:new', title: 'New game', priceStatus: 'unresolved' }],
    }] } };
    calls.epicProgressListener({
        accountId: 'new-account', syncRunId: 'run-1', libraryRevision: 1, committedRevision: 1,
        phase: 'library', phaseStatus: 'complete',
        state: { revision: 1, syncRunId: 'run-1', overallStatus: 'library_ready_enriching', phases: { library: { status: 'complete', committedRevision: 1 }, prices: { status: 'pending' }, purchaseHistory: { status: 'pending' } } },
    });
    await Promise.resolve();
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(elements.get('vaultOverviewAccountsPlatforms').textContent, '1 / 1');
    assert.equal(elements.get('vaultOverviewTotalGames').textContent, '1');
    assert.match(elements.get('vaultOverviewStatus').innerHTML, /Your library is ready/);
});

test('A stale Vault IPC response cannot replace a newer accepted overview snapshot', async () => {
    const { sandbox, elements, calls } = createVaultRuntimeSandbox();
    calls.vaultResponse = { vault: { accounts: [{ accountId: 'a', vaultRevision: 3, currency: 'USD', games: [{ vaultCanonicalKey: 'one' }] }] } };
    sandbox.window.openVaultPlatform('overview');
    await Promise.resolve();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(elements.get('vaultOverviewTotalGames').textContent, '1');

    calls.vaultResponse = { vault: { accounts: [], generatedAt: '2026-09-06T00:00:00.000Z' } };
    await sandbox.window.invalidateEpicVaultCache(true, { reason: 'stale-test' });
    assert.equal(elements.get('vaultOverviewTotalGames').textContent, '1');
    assert.equal(elements.get('vaultOverviewAccountsPlatforms').textContent, '1 / 1');
});

test('A transient Vault IPC failure preserves last-good overview data and exposes retry state', async () => {
    const { sandbox, elements } = createVaultRuntimeSandbox();
    sandbox.window.openVaultPlatform('overview');
    await Promise.resolve();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(elements.get('vaultOverviewTotalGames').textContent, '1');

    sandbox.window.electronAPI.platformSyncGetEpicVault = async () => { throw new Error('temporary read failure'); };
    await sandbox.window.invalidateEpicVaultCache(true, { reason: 'error-test' });
    assert.equal(elements.get('vaultOverviewTotalGames').textContent, '1');
    assert.match(elements.get('vaultOverviewStatus').innerHTML, /Saved Vault data is still shown/);
    assert.match(elements.get('vaultOverviewStatus').innerHTML, /Retry/);
});


test('Epic account changes dirty a closed Vault cache and force hydration on the next open', async () => {
    const { sandbox, calls, elements } = createVaultRuntimeSandbox();
    sandbox.window.openVaultPlatform('overview');
    await Promise.resolve();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.hydrate, 1);

    sandbox.currentView = 'home';
    calls.vaultResponse = { vault: { accounts: [{ accountId: 'new-account', vaultRevision: 2, currency: 'USD', games: [] }] } };
    calls.accountsChangedListener({ platform: 'epic', reason: 'linked', changeRevision: 1 });
    await Promise.resolve();
    assert.equal(calls.hydrate, 1, 'closed Vault should preserve cache without immediate IPC');

    sandbox.currentView = 'vault';
    sandbox.window.openVaultPlatform('overview');
    await Promise.resolve();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.hydrate, 2);
    assert.equal(elements.get('vaultOverviewAccountsPlatforms').textContent, '1 / 1');
});

test('Epic account event refreshes an open Vault and never reinserts the selected unlinked account', async () => {
    const { sandbox, calls, elements } = createVaultRuntimeSandbox();
    calls.vaultResponse = { vault: { accounts: [{ accountId: 'account-a', displayName: 'A', vaultRevision: 4, currency: 'USD', games: [] }] } };
    sandbox.window.openVaultPlatform('overview');
    await Promise.resolve();
    await new Promise(resolve => setImmediate(resolve));
    sandbox.window.selectVaultPlatform('epic');
    sandbox.window.selectVaultEpicAccount('account-a');

    calls.vaultResponse = { vault: { accounts: [], generatedAt: '2026-09-09T00:00:00.000Z' } };
    calls.accountsChangedListener({ platform: 'epic', reason: 'unlinked', changeRevision: 2 });
    await Promise.resolve();
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(calls.hydrate, 2);
    assert.match(elements.get('vaultEpicLibrary').innerHTML, /No Epic accounts linked/);
    assert.doesNotMatch(elements.get('vaultEpicLibrary').innerHTML, />A</);
});

test('Epic library commit refreshes an open Vault without auth or full sync', async () => {
    const { sandbox, calls } = createVaultRuntimeSandbox();
    sandbox.window.openVaultPlatform('overview');
    await Promise.resolve();
    await new Promise(resolve => setImmediate(resolve));
    calls.libraryCommittedListener({ platform: 'epic', revision: 8 });
    await Promise.resolve();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.hydrate, 2);
    assert.equal(calls.auth, 0);
    assert.equal(calls.sync, 0);
});


test('explicit Epic account selection resets the real Vault scroller for first selection and A to B', async () => {
    const { sandbox, calls, elements } = createVaultRuntimeSandbox();
    const accounts = [
        { accountId: 'account-a', displayName: 'A', vaultRevision: 2, currency: 'USD', games: [] },
        { accountId: 'account-b', displayName: 'B', vaultRevision: 2, currency: 'USD', games: [] },
    ];
    calls.vaultResponse = { vault: { accounts, vaultRevision: 2 } };
    sandbox.window.openVaultPlatform('overview');
    await Promise.resolve();
    await new Promise(resolve => setImmediate(resolve));
    sandbox.window.selectVaultPlatform('epic');

    const scroller = elements.get('mainContentArea');
    scroller.scrollTop = 720;
    sandbox.window.selectVaultEpicAccount('account-a');
    assert.equal(scroller.scrollTop, 0);

    scroller.scrollTop = 480;
    sandbox.window.selectVaultEpicAccount('account-b');
    assert.equal(scroller.scrollTop, 0);
});

test('late background hydration cannot restore the previous account scroll anchor', async () => {
    const { sandbox, calls, elements } = createVaultRuntimeSandbox();
    const accounts = [
        { accountId: 'account-a', displayName: 'A', vaultRevision: 3, currency: 'USD', games: [] },
        { accountId: 'account-b', displayName: 'B', vaultRevision: 3, currency: 'USD', games: [] },
    ];
    calls.vaultResponse = { vault: { accounts, vaultRevision: 3 } };
    sandbox.window.openVaultPlatform('overview');
    await Promise.resolve();
    await new Promise(resolve => setImmediate(resolve));
    sandbox.window.selectVaultPlatform('epic');
    sandbox.window.selectVaultEpicAccount('account-a');

    let settle;
    calls.vaultPromise = new Promise(resolve => { settle = resolve; });
    const refresh = sandbox.window.invalidateEpicVaultCache(true, { reason: 'background-sync-complete', preserveScroll: true });
    const scroller = elements.get('mainContentArea');
    scroller.scrollTop = 640;
    sandbox.window.selectVaultEpicAccount('account-b');
    assert.equal(scroller.scrollTop, 0);

    settle({ vault: { accounts, vaultRevision: 4 } });
    await refresh;
    await Promise.resolve();
    assert.equal(scroller.scrollTop, 0);
});


test('background Vault hydration preserves account scroll while explicit selection shows the header at top', async () => {
    const { sandbox, calls, elements } = createVaultRuntimeSandbox();
    const accounts = [{ accountId: 'account-a', displayName: 'A', vaultRevision: 5, currency: 'USD', games: [] }];
    calls.vaultResponse = { vault: { accounts, vaultRevision: 5 } };
    sandbox.window.openVaultPlatform('overview');
    await Promise.resolve();
    await new Promise(resolve => setImmediate(resolve));
    sandbox.window.selectVaultPlatform('epic');
    const scroller = elements.get('mainContentArea');
    scroller.scrollTop = 900;
    sandbox.window.selectVaultEpicAccount('account-a');
    assert.equal(scroller.scrollTop, 0);
    assert.match(elements.get('vaultEpicLibrary').innerHTML, /vault-account-summary/);

    scroller.scrollTop = 360;
    let settle;
    calls.vaultPromise = new Promise(resolve => { settle = resolve; });
    const refresh = sandbox.window.invalidateEpicVaultCache(true, { reason: 'background-price-refresh', preserveScroll: true });
    settle({ vault: { accounts: [{ ...accounts[0], vaultRevision: 6 }], vaultRevision: 6 } });
    await refresh;
    await Promise.resolve();
    assert.equal(scroller.scrollTop, 360);
});
