const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildSteamLibraryCardUrl,
    buildSteamHeaderUrl,
    buildSteamCapsuleUrl,
    buildSteamOfficialLogoUrl,
    steamImageLinkExamples,
    isLowQualitySteamCoverUrl,
    isLowQualitySteamHeroUrl,
    STEAM_STORE_ASSETS,
} = require('../services/steamLibraryAssets');

test('Steam CDN URL builders (library grid + header/capsule fallbacks)', () => {
    const ex = steamImageLinkExamples('730');
    assert.ok(ex.libraryCard.startsWith('https://'));
    assert.match(ex.libraryCard, /\/730\/library_600x900\.jpg$/);
    assert.match(ex.libraryHero, /\/730\/library_hero\.jpg$/);
    assert.equal(ex.header, buildSteamHeaderUrl('730', false));
    assert.match(ex.header, /\/730\/header\.jpg$/);
    assert.match(ex.capsule616, /\/730\/capsule_616x353\.jpg$/);
    assert.match(ex.officialLogo, /\/730\/logo\.png$/);
    assert.equal(buildSteamLibraryCardUrl(620), `${STEAM_STORE_ASSETS}/620/library_600x900.jpg`);
    assert.equal(buildSteamHeaderUrl(620, true), `https://steamcdn-a.akamaihd.net/steam/apps/620/header.jpg`);
    assert.equal(buildSteamCapsuleUrl(620, '616x353'), `https://steamcdn-a.akamaihd.net/steam/apps/620/capsule_616x353.jpg`);
    assert.equal(buildSteamOfficialLogoUrl(620), `${STEAM_STORE_ASSETS}/620/logo.png`);
});

test('steamImageLinkExamples leaves APP_ID placeholder for documentation', () => {
    const tpl = steamImageLinkExamples();
    assert.match(tpl.libraryCard, /APP_ID\/library_600x900\.jpg$/);
});

test('micro Steam capsule URLs are rejected for cover (231×87 etc.)', () => {
    const u = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/407530/capsule_231x87.jpg?t=1';
    assert.equal(isLowQualitySteamCoverUrl(u), true);
    assert.equal(isLowQualitySteamHeroUrl(u), true);
    assert.equal(isLowQualitySteamCoverUrl('https://steamcdn-a.akamaihd.net/steam/apps/1/capsule_467x181.jpg'), true);
    assert.equal(isLowQualitySteamCoverUrl('https://steamcdn-a.akamaihd.net/steam/apps/1/capsule_616x353.jpg'), false);
    assert.equal(isLowQualitySteamHeroUrl('https://steamcdn-a.akamaihd.net/steam/apps/1/capsule_467x181.jpg'), false);
});

test('Steam header.jpg is rejected for cover (460×215 wide strip)', () => {
    const h = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/407530/header.jpg?t=1';
    assert.equal(isLowQualitySteamCoverUrl(h), true);
    assert.equal(isLowQualitySteamHeroUrl(h), false);
});
