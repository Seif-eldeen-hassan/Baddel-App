'use strict';

;(function () {
const root = typeof window !== 'undefined' ? window : globalThis;

function _value(item) {
    return item?.effectiveValue || item?.value || null;
}

function selectCardArtwork(model, { previousCover = null } = {}) {
    const cover = _value(model?.cover);
    if (cover) return { value: cover, pending: false, terminal: false };
    if (model?.cover?.pending) return { value: previousCover, pending: true, terminal: false };
    return { value: null, pending: false, terminal: true };
}

function selectHomeHeroArtwork(model, { previousHero = null, previousLogo = null } = {}) {
    const hero = _value(model?.hero);
    const cover = _value(model?.cover);
    const logo = _value(model?.logo);
    return {
        background: hero || (model?.hero?.terminal === true ? cover : previousHero),
        backgroundSource: hero ? 'hero' : (model?.hero?.terminal === true && cover ? 'cover-terminal-fallback' : 'previous-pending'),
        logo: logo || (model?.logo?.pending ? previousLogo : null),
        logoSource: logo ? 'logo' : (model?.logo?.pending ? 'previous-pending' : 'text-terminal-fallback'),
        heroPending: model?.hero?.pending === true,
        logoPending: model?.logo?.pending === true,
    };
}

function createAtomicArtworkCommitGuard() {
    let generation = 0;
    let identity = null;
    return {
        begin(nextIdentity) {
            identity = String(nextIdentity || '');
            generation += 1;
            return { identity, generation };
        },
        accepts(token, decoded = true) {
            return decoded === true && token?.generation === generation && String(token?.identity || '') === identity;
        },
        snapshot() { return { identity, generation }; },
    };
}

function visibleArtworkWork(games, { visibleLimit = 15, nearVisible = 0 } = {}) {
    const max = Math.max(0, Number(visibleLimit) || 0) + Math.max(0, Number(nearVisible) || 0);
    return (Array.isArray(games) ? games : []).slice(0, max);
}

const api = { selectCardArtwork, selectHomeHeroArtwork, createAtomicArtworkCommitGuard, visibleArtworkWork };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (root) root.BaddelHomeArtworkPresentation = api;
}());
