const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

function extractFn(src, name) {
  const re = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`);
  const m = re.exec(src);
  assert.ok(m, `missing function ${name}`);
  let i = m.index + m[0].length;
  let depth = 1;
  while (i < src.length && depth > 0) {
    const ch = src[i++];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
  }
  assert.equal(depth, 0, `unbalanced function ${name}`);
  return src.slice(m.index, i);
}

test('shared artwork bulk resolver uses canonical cache keys and one bulk IPC per artwork type', () => {
  const src = read('src/js/app/artwork-sync.js');
  const body = extractFn(src, '__baddelResolveBulkArtworkForGames');
  assert.match(src, /window\.__baddelResolveArtworkCacheBulk\s*=\s*window\.__baddelResolveBulkArtworkForGames/);
  assert.match(src, /BaddelGameArtworkReadModel\?\.resolveArtworkCacheKeys/);
  assert.match(body, /electronAPI\.getCachedImagesBulk\(identities,\s*type\)/);
  assert.match(body, /const detailed = responses\[type\]\?\.results \|\| \{\}/);
  assert.match(body, /const hit = detailed\[row\.primaryKey\] \|\| images\[row\.primaryKey\]/);
  assert.match(body, /matchedAlias/);
  assert.match(body, /_bulkArtworkApply\(row\.game,\s*row\.resolved/);
});

test('Installed grid resolves local covers in bulk before building cards', () => {
  const src = read('src/js/app.js');
  const body = extractFn(src, 'applyFilters');
  assert.match(body, /await\s+window\.__baddelResolveArtworkCacheBulk\?\.\(filtered,\s*\{\s*types:\s*\['cover'\],\s*surface:\s*'installed-grid'/);
  assert.ok(body.indexOf('__baddelResolveArtworkCacheBulk') < body.indexOf('createGameCard(game)'), 'bulk resolve must happen before createGameCard');
});

test('Installed prepared snapshot resolves local covers in bulk before rendering', () => {
  const src = read('src/js/app.js');
  const body = extractFn(src, '_renderInstalledSnapshot');
  assert.match(body, /await\s+window\.__baddelResolveArtworkCacheBulk\?\.\(games,\s*\{\s*types:\s*\['cover'\],\s*surface:\s*'installed-snapshot'/);
  assert.ok(body.indexOf('__baddelResolveArtworkCacheBulk') < body.indexOf('createGameCard(game)'), 'snapshot bulk resolve must happen before createGameCard');
});

test('Home Explore and Jump Back In resolve cover hero logo through shared bulk resolver', () => {
  const app = read('src/js/app.js');
  const cards = read('src/js/app/game-card.js');
  const explore = extractFn(app, 'renderExploreCarousel');
  const jbi = extractFn(cards, 'renderRecentlyPlayed');
  assert.match(explore, /await\s+window\.__baddelResolveArtworkCacheBulk\?\.\(shuffled,\s*\{\s*types:\s*\['cover',\s*'hero',\s*'logo'\],\s*surface:\s*'home-explore'/);
  assert.ok(explore.indexOf('__baddelResolveArtworkCacheBulk') < explore.indexOf('createGameCard(game'), 'Explore bulk resolve must happen before card creation');
  assert.match(jbi, /await\s+window\.__baddelResolveArtworkCacheBulk\?\.\(recent,\s*\{\s*types:\s*\['cover',\s*'hero',\s*'logo'\],\s*surface:\s*'home-jump-back-in'/);
  assert.ok(jbi.indexOf('__baddelResolveArtworkCacheBulk') < jbi.indexOf('createRecentCard(game'), 'JBI bulk resolve must happen before recent card creation');
});

test('Home Hero uses shared bulk resolver before falling back to single-game lookup', () => {
  const src = read('src/js/app/hero.js');
  const body = extractFn(src, '_homeHeroHydrateCachedArtwork');
  assert.match(body, /window\.__baddelResolveArtworkCacheBulk/);
  assert.match(body, /surface:\s*source\s*\|\|\s*'home-hero'/);
  assert.ok(body.indexOf('__baddelResolveArtworkCacheBulk') < body.indexOf('__baddelLoadCachedArtworkForGame'), 'hero should prefer shared bulk resolver');
});

test('bulk-resolved card misses do not fan out into per-card metadata/cache lookup', () => {
  const src = read('src/js/app/game-card.js');
  const body = extractFn(src, 'createGameCard');
  assert.match(body, /bulkResolvedMiss/);
  assert.match(body, /if \(!bulkResolvedMiss\) fetchMetadata\(imgEl,\s*game\)/);
});

test('Installed projection dedupes canonical delegated products and guards stale async renders', () => {
  const src = read('src/js/app.js');
  const snapshot = extractFn(src, '_computeInstalledGamesSnapshot');
  const prepared = extractFn(src, '_renderInstalledSnapshot');
  const filters = extractFn(src, 'applyFilters');
  assert.match(src, /function _dedupeInstalledProductProjection/);
  assert.match(snapshot, /_dedupeInstalledProductProjection\(games\)/);
  assert.match(filters, /let filtered = _dedupeInstalledProductProjection\(allGamesData\)/);
  assert.match(prepared, /const generation = _nextInstalledRenderGeneration\(\)/);
  assert.match(prepared, /if \(!_isInstalledRenderGenerationCurrent\(generation\)\) return false/);
  assert.match(filters, /if \(!_isInstalledRenderGenerationCurrent\(generation\)\) return/);
});

test('bulk artwork resolver is a one-to-one projection and never concatenates inputs', () => {
  const src = read('src/js/app/artwork-sync.js');
  const body = extractFn(src, '__baddelResolveBulkArtworkForGames');
  assert.match(body, /const list = \(Array\.isArray\(games\) \? games : \[\]\)\.filter\(Boolean\)/);
  assert.match(body, /for \(const game of list\)/);
  assert.doesNotMatch(body, /concat\(/);
  assert.doesNotMatch(body, /\.push\(\.\.\.list\)/);
  assert.match(body, /return \{ status: 'success', surface, games: list\.length/);
});

test('VALORANT typed surfaces keep independent cover hero logo lookup paths', () => {
  const readModel = require('../src/features/games/application/services/GameArtworkReadModel');
  const keys = readModel.resolveArtworkCacheKeys(
    { id: 'riot-valorant', installedGameKey: 'riot:valorant', allIds: { riot: 'valorant' }, launcherGameId: 'valorant' },
    { id: 'riot-valorant', installedGameKey: 'riot:valorant', allIds: { riot: 'valorant' }, launcherGameId: 'valorant' }
  );
  assert.ok(keys.includes('riot-valorant'));
  assert.ok(keys.includes('riot:valorant'));
  const app = read('src/js/app/hero.js');
  const hero = extractFn(app, '_homeHeroArtworkFor');
  assert.match(hero, /localHero/);
  assert.match(hero, /localCover/);
  assert.match(hero, /readModel\?\.hero\?\.terminal === true \? localCover : null/);
  const cards = read('src/js/app/game-card.js');
  const recent = extractFn(cards, 'createRecentCard');
  assert.ok(recent.indexOf('game.__baddelResolvedLocalHero') < recent.indexOf('game.__baddelResolvedLocalCover'));
});

test('Windows Store package identity participates in artwork cache aliases', () => {
  const readModel = require('../src/features/games/application/services/GameArtworkReadModel');
  const keys = readModel.resolveArtworkCacheKeys({
    id: 'xbox-Microsoft-MicrosoftSolitaireCollection_8wekyb3d8bbwe',
    platform: 'Xbox / Store',
    packageFamilyName: 'Microsoft.MicrosoftSolitaireCollection_8wekyb3d8bbwe',
    appUserModelId: 'Microsoft.MicrosoftSolitaireCollection_8wekyb3d8bbwe!App',
    launcherGameId: 'Microsoft.MicrosoftSolitaireCollection_8wekyb3d8bbwe',
    command: 'shell:AppsFolder\\Microsoft.MicrosoftSolitaireCollection_8wekyb3d8bbwe!App',
    allIds: { xbox: 'Microsoft.MicrosoftSolitaireCollection_8wekyb3d8bbwe' },
  });
  assert.ok(keys.includes('Microsoft.MicrosoftSolitaireCollection_8wekyb3d8bbwe'));
  assert.ok(keys.includes('Microsoft.MicrosoftSolitaireCollection_8wekyb3d8bbwe!App'));
});
test('main bulk artwork cache handler returns detailed results and backfills aliases through the shared cache owner', () => {
  const src = read('handlers/imageHandlers.js');
  assert.match(src, /function _resolveCachedImageLocalDetails/);
  assert.match(src, /ipcMain\.handle\('get-cached-images-bulk'/);
  assert.match(src, /const results = \{\}/);
  assert.match(src, /matchedAlias/);
  assert.match(src, /assetHash/);
  assert.match(src, /artworkDownloadManager\.beginManifestTransaction/);
  assert.match(src, /artworkDownloadManager\.linkCachedAlias/);
  assert.match(src, /artworkDownloadManager\.commitManifestTransaction/);
  assert.match(src, /persistedPathHits/);
  assert.match(src, /cacheGeneration/);
  assert.match(src, /source: 'persisted-managed-file'/);
});
