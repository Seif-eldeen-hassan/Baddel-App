'use strict';

const STEAM_STORE_ASSETS = 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps';
const STEAM_CDN          = 'https://steamcdn-a.akamaihd.net/steam/apps';

function buildSteamLibraryCardUrl(appid) {
    return `${STEAM_STORE_ASSETS}/${appid}/library_600x900.jpg`;
}

function buildSteamHeaderUrl(appid, useCdn = false) {
    const base = useCdn ? STEAM_CDN : STEAM_STORE_ASSETS;
    return `${base}/${appid}/header.jpg`;
}

function buildSteamCapsuleUrl(appid, size = '616x353') {
    return `${STEAM_CDN}/${appid}/capsule_${size}.jpg`;
}

function buildSteamOfficialLogoUrl(appid) {
    return `${STEAM_STORE_ASSETS}/${appid}/logo.png`;
}

function steamImageLinkExamples(appid = 'APP_ID') {
    return {
        libraryCard:  buildSteamLibraryCardUrl(appid),
        libraryHero:  `${STEAM_STORE_ASSETS}/${appid}/library_hero.jpg`,
        header:       buildSteamHeaderUrl(appid, false),
        capsule616:   buildSteamCapsuleUrl(appid, '616x353'),
        officialLogo: buildSteamOfficialLogoUrl(appid),
    };
}

function isLowQualitySteamCoverUrl(url) {
    if (!url) return false;
    if (/\/header\.jpg/.test(url)) return true;
    const m = url.match(/capsule_(\d+)x\d+/);
    if (m) return parseInt(m[1], 10) < 600;
    return false;
}

function isLowQualitySteamHeroUrl(url) {
    if (!url) return false;
    const m = url.match(/capsule_(\d+)x(\d+)/);
    if (m) return parseInt(m[1], 10) * parseInt(m[2], 10) < 30000;
    return false;
}

module.exports = {
    STEAM_STORE_ASSETS,
    buildSteamLibraryCardUrl,
    buildSteamHeaderUrl,
    buildSteamCapsuleUrl,
    buildSteamOfficialLogoUrl,
    steamImageLinkExamples,
    isLowQualitySteamCoverUrl,
    isLowQualitySteamHeroUrl,
};
