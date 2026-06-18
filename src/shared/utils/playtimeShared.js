'use strict';

// Pure functions for game process matching — extracted from main.js so they
// can be unit-tested without an Electron environment.
// The live process-monitor loop in main.js requires these via destructured require.

function _cleanGameMatchText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/\.exe$/i, '')
        .replace(/[^a-z0-9]/g, '');
}

// Returns true when `suffix` (the chars after the clean game name inside the
// process name) is a known technical/build qualifier that should not prevent
// a match — e.g. "win64", "shipping", "dx11".
function _isTechnicalExeSuffix(suffix) {
    const s = String(suffix || '').toLowerCase();
    if (!s) return true;
    return /^(win64|win32|x64|x86|shipping|win64shipping|win32shipping|dx11|dx12|vulkan|game|launcher|client|retail|final|release)+$/.test(s);
}

// Returns true when `suffix` looks like a sequel/version indicator — e.g. "2",
// "ii", "iv" — meaning the process name is a DIFFERENT game, not the same one
// with a build tag.  Prevents "Little Nightmares" matching "littlenightmaresii".
function _isVersionLikeSuffix(suffix) {
    const s = String(suffix || '').toLowerCase();
    if (!s) return false;
    return /^(\d+|i|ii|iii|iv|v|vi|vii|viii|ix|x)$/.test(s);
}

// Returns true if processName plausibly belongs to gameName.
// Three rules:
//  1. Exact alphanumeric equality.
//  2. Process = game + technical suffix  (e.g. acmiragewin64shipping → acmirage).
//  3. Game starts with the process name AND process is ≥ 8 chars (avoids tiny
//     generic fragments like "halo" matching "halogen").
// Sequel suffixes always block a match.
function _safeFuzzyGameNameMatch(gameName, processName) {
    const cleanGame = _cleanGameMatchText(gameName);
    const cleanProc = _cleanGameMatchText(processName);

    if (!cleanGame || cleanProc.length < 3) return false;
    if (cleanGame === cleanProc) return true;

    if (cleanProc.startsWith(cleanGame)) {
        const suffix = cleanProc.slice(cleanGame.length);
        if (_isVersionLikeSuffix(suffix)) return false;
        return _isTechnicalExeSuffix(suffix);
    }

    if (cleanGame.startsWith(cleanProc) && cleanProc.length >= 8) {
        const suffix = cleanGame.slice(cleanProc.length);
        if (_isVersionLikeSuffix(suffix)) return false;
        return true;
    }

    return false;
}

module.exports = {
    _cleanGameMatchText,
    _isTechnicalExeSuffix,
    _isVersionLikeSuffix,
    _safeFuzzyGameNameMatch,
};
