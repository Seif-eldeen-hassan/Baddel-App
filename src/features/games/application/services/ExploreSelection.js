'use strict';

(function() {

function createExploreSelectionState({ sessionSeed = String(Date.now()) } = {}) {
    return {
        sessionSeed,
        membershipSignature: '',
        selectionIds: [],
        refreshNonce: 0,
    };
}

function _gameId(game) {
    return String(game?.id ?? game?.appName ?? game?.title ?? game?.name ?? '').trim();
}

function _membershipSignature(games) {
    return (Array.isArray(games) ? games : [])
        .map(_gameId)
        .filter(Boolean)
        .sort()
        .join('|');
}

function _hash(value) {
    let h = 2166136261;
    const s = String(value);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function _stableRank(id, seed) {
    return _hash(`${seed}:${id}`);
}

function _select(games, state, limit) {
    const seed = `${state.sessionSeed}:${state.refreshNonce}`;
    return (Array.isArray(games) ? games : [])
        .map(g => ({ id: _gameId(g), rank: _stableRank(_gameId(g), seed) }))
        .filter(item => item.id)
        .sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id))
        .slice(0, limit)
        .map(item => item.id);
}

function selectExploreGameIds(games, state = createExploreSelectionState(), {
    limit = 15,
    forceRefresh = false,
} = {}) {
    const signature = _membershipSignature(games);
    const knownIds = new Set((Array.isArray(games) ? games : []).map(_gameId).filter(Boolean));
    const selectionStillValid =
        Array.isArray(state.selectionIds) &&
        state.selectionIds.length > 0 &&
        state.selectionIds.every(id => knownIds.has(String(id)));

    if (forceRefresh) state.refreshNonce = (state.refreshNonce || 0) + 1;

    if (
        forceRefresh ||
        state.membershipSignature !== signature ||
        !selectionStillValid
    ) {
        state.membershipSignature = signature;
        state.selectionIds = _select(games, state, limit);
    }
    return state.selectionIds.slice();
}

const ExploreSelectionApi = {
    createExploreSelectionState,
    selectExploreGameIds,
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ExploreSelectionApi;
}

const _root =
    (typeof window !== 'undefined') ? window :
    (typeof globalThis !== 'undefined') ? globalThis :
    null;
if (_root) {
    _root.BaddelExploreSelection = ExploreSelectionApi;
}

})();
