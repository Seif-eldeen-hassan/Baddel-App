'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    createExploreSelectionState,
    selectExploreGameIds,
} = require('../src/features/games/application/services/ExploreSelection');

function games(ids) {
    return ids.map(id => ({ id, name: `Game ${id}` }));
}

test('Explore selection remains stable across unchanged background updates', () => {
    const state = createExploreSelectionState({ sessionSeed: 'session-a' });
    const library = games(Array.from({ length: 30 }, (_, i) => `g${i + 1}`));

    const first = selectExploreGameIds(library, state);
    const afterArtworkUpdate = selectExploreGameIds(library.map(g => ({ ...g, image: `cover-${g.id}.jpg` })), state, {
        reason: 'artwork-update',
    });
    const afterMetadataUpdate = selectExploreGameIds(library.map(g => ({ ...g, description: `meta-${g.id}` })), state, {
        reason: 'metadata-update',
    });
    const afterPlaytimeUpdate = selectExploreGameIds(library.map(g => ({ ...g, totalPlaytime: 5 })), state, {
        reason: 'playtime-update',
    });
    const afterUnchangedLibraryUpdate = selectExploreGameIds(library.map(g => ({ ...g })), state, {
        reason: 'library-updated',
    });

    assert.deepEqual(afterArtworkUpdate, first);
    assert.deepEqual(afterMetadataUpdate, first);
    assert.deepEqual(afterPlaytimeUpdate, first);
    assert.deepEqual(afterUnchangedLibraryUpdate, first);
});

test('Explore selection recomputes only when membership changes or explicit refresh is requested', () => {
    const state = createExploreSelectionState({ sessionSeed: 'session-a' });
    const library = games(Array.from({ length: 30 }, (_, i) => `g${i + 1}`));

    const first = selectExploreGameIds(library, state);
    const sameMembership = selectExploreGameIds([...library].reverse(), state);
    const membershipChanged = selectExploreGameIds([...library, { id: 'g31', name: 'Game 31' }], state);
    const explicitRefresh = selectExploreGameIds(library, state, { forceRefresh: true });

    assert.deepEqual(sameMembership, first);
    assert.notDeepEqual(membershipChanged, first);
    assert.notDeepEqual(explicitRefresh, first);
});
