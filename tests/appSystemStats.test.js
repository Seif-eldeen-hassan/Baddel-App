'use strict';

const fs   = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const ROOT   = path.join(__dirname, '..');
const APP_JS = fs.readFileSync(path.join(ROOT, 'src/js/app.js'), 'utf8');
const HTML   = fs.readFileSync(path.join(ROOT, 'src/dashboard.html'), 'utf8');

// ── Extraction helper ─────────────────────────────────────────────────────────

function getFunctionBody(source, functionName) {
    const marker = 'function ' + functionName;
    const start = source.indexOf(marker);
    if (start === -1) return '';
    const braceOpen = source.indexOf('{', start);
    if (braceOpen === -1) return '';
    let depth = 0;
    for (let i = braceOpen; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}') {
            depth--;
            if (depth === 0) return source.slice(start, i + 1);
        }
    }
    return source.slice(start);
}

// ── Section 1: Source presence in app.js ─────────────────────────────────────

describe('Phase 2.16A: system stats — source presence in app.js', () => {
    it('checkAndManagePolling is defined', () => {
        assert.match(APP_JS, /function checkAndManagePolling\s*\(\s*\)/);
    });
    it('toggleSensors is defined', () => {
        assert.match(APP_JS, /function toggleSensors\s*\(\s*\)/);
    });
    it('_resetStatsUI is defined', () => {
        assert.match(APP_JS, /function _resetStatsUI\s*\(\s*\)/);
    });
    it('initSystemStats is defined as an async function', () => {
        assert.match(APP_JS, /async function initSystemStats\s*\(\s*\)/);
    });
    it('_loadStaticInfo is defined as an async function', () => {
        assert.match(APP_JS, /async function _loadStaticInfo\s*\(\s*\)/);
    });
    it('_tickStats is defined as an async function', () => {
        assert.match(APP_JS, /async function _tickStats\s*\(\s*\)/);
    });
    it('_setText is defined', () => {
        assert.match(APP_JS, /function _setText\s*\(/);
    });
    it('_setBar is defined', () => {
        assert.match(APP_JS, /function _setBar\s*\(/);
    });
    it('_fmtBytes is defined', () => {
        assert.match(APP_JS, /function _fmtBytes\s*\(/);
    });
    it('_fmtSpeed is defined', () => {
        assert.match(APP_JS, /function _fmtSpeed\s*\(/);
    });
    it('_shortName is defined', () => {
        assert.match(APP_JS, /function _shortName\s*\(/);
    });
    it('cyclePlaytimeFormat is defined', () => {
        assert.match(APP_JS, /function cyclePlaytimeFormat\s*\(\s*\)/);
    });
    it('togglePlaytimeDropdown is defined', () => {
        assert.match(APP_JS, /function togglePlaytimeDropdown\s*\(/);
    });
    it('selectPlaytime is defined', () => {
        assert.match(APP_JS, /function selectPlaytime\s*\(/);
    });
    it('updateFooterStats is defined', () => {
        assert.match(APP_JS, /function updateFooterStats\s*\(\s*\)/);
    });
    it('system stats section header comment is present', () => {
        assert.match(APP_JS, /\/\/ 13\. SYSTEM STATS HUD/);
    });
});

// ── Section 2: State variables ────────────────────────────────────────────────

describe('Phase 2.16A: system stats — state variables in app.js', () => {
    it('_prevNetBytes is declared with initial rx/tx/ts values', () => {
        assert.match(APP_JS, /^let _prevNetBytes\s*=\s*\{/m);
        assert.match(APP_JS, /rx:\s*0/);
        assert.match(APP_JS, /tx:\s*0/);
        assert.match(APP_JS, /ts:\s*0/);
    });
    it('_hudInterval is declared', () => {
        assert.match(APP_JS, /^let _hudInterval\s*=\s*null/m);
    });
    it('_isStatsInit is declared', () => {
        assert.match(APP_JS, /^let _isStatsInit\s*=\s*false/m);
    });
    it('_isStatsBusy is declared', () => {
        assert.match(APP_JS, /^let _isStatsBusy\s*=\s*false/m);
    });
    it('isSensorEnabled is declared and reads baddel_sensors_enabled from localStorage', () => {
        assert.match(APP_JS, /^let isSensorEnabled\s*=/m);
        assert.match(APP_JS, /localStorage\.getItem\('baddel_sensors_enabled'\)/);
    });
    it('currentPlaytimeFormat is declared', () => {
        assert.match(APP_JS, /^let currentPlaytimeFormat\s*=\s*0/m);
    });
    it('currentPlaytimeFilterValue is declared with default "all"', () => {
        assert.match(APP_JS, /^let currentPlaytimeFilterValue\s*=\s*'all'/m);
    });
});

// ── Section 3: checkAndManagePolling behaviour ────────────────────────────────

describe('Phase 2.16A: system stats — checkAndManagePolling behaviour', () => {
    it('polls only when isSensorEnabled, hasFocus, and currentView is home', () => {
        const fn = getFunctionBody(APP_JS, 'checkAndManagePolling');
        assert.match(fn, /isSensorEnabled/);
        assert.match(fn, /hasFocus/);
        assert.match(fn, /isHomeView/);
        assert.match(fn, /currentView\s*===\s*'home'/);
    });
    it('starts the HUD interval using _tickStats every 3 seconds', () => {
        const fn = getFunctionBody(APP_JS, 'checkAndManagePolling');
        assert.match(fn, /setInterval\(_tickStats/);
        assert.match(fn, /3000/);
    });
    it('stores interval handle in _hudInterval', () => {
        const fn = getFunctionBody(APP_JS, 'checkAndManagePolling');
        assert.match(fn, /_hudInterval\s*=/);
    });
    it('clears _hudInterval when conditions are not met', () => {
        const fn = getFunctionBody(APP_JS, 'checkAndManagePolling');
        assert.match(fn, /clearInterval\(_hudInterval\)/);
        assert.match(fn, /_hudInterval\s*=\s*null/);
    });
    it('updates sysLiveDot opacity to indicate polling state', () => {
        const fn = getFunctionBody(APP_JS, 'checkAndManagePolling');
        assert.match(fn, /getElementById\('sysLiveDot'\)/);
        assert.match(fn, /liveDot\.style\.opacity/);
    });
    it('calls _tickStats immediately when starting the interval', () => {
        const fn = getFunctionBody(APP_JS, 'checkAndManagePolling');
        assert.match(fn, /_tickStats\(\)/);
    });
});

// ── Section 4: toggleSensors behaviour ────────────────────────────────────────

describe('Phase 2.16A: system stats — toggleSensors behaviour', () => {
    it('flips isSensorEnabled and persists it to localStorage', () => {
        const fn = getFunctionBody(APP_JS, 'toggleSensors');
        assert.match(fn, /isSensorEnabled\s*=\s*!isSensorEnabled/);
        assert.match(fn, /localStorage\.setItem\('baddel_sensors_enabled'/);
    });
    it('calls window.electronAPI.logHudSensorToggled with the new state', () => {
        const fn = getFunctionBody(APP_JS, 'toggleSensors');
        assert.match(fn, /window\.electronAPI\.logHudSensorToggled/);
    });
    it('toggles sensorToggleBtn off class based on enabled state', () => {
        const fn = getFunctionBody(APP_JS, 'toggleSensors');
        assert.match(fn, /getElementById\('sensorToggleBtn'\)/);
        assert.match(fn, /classList\.remove\('off'\)/);
        assert.match(fn, /classList\.add\('off'\)/);
    });
    it('updates sensorToggleText to "SENSORS: ON" or "SENSORS: OFF"', () => {
        const fn = getFunctionBody(APP_JS, 'toggleSensors');
        assert.match(fn, /getElementById\('sensorToggleText'\)/);
        assert.match(fn, /SENSORS: ON/);
        assert.match(fn, /SENSORS: OFF/);
    });
    it('calls _tickStats when enabling sensors', () => {
        const fn = getFunctionBody(APP_JS, 'toggleSensors');
        assert.match(fn, /_tickStats\(\)/);
    });
    it('calls _resetStatsUI when disabling sensors', () => {
        const fn = getFunctionBody(APP_JS, 'toggleSensors');
        assert.match(fn, /_resetStatsUI\(\)/);
    });
    it('calls checkAndManagePolling after toggling', () => {
        const fn = getFunctionBody(APP_JS, 'toggleSensors');
        assert.match(fn, /checkAndManagePolling\(\)/);
    });
});

// ── Section 5: initSystemStats and _loadStaticInfo behaviour ─────────────────

describe('Phase 2.16A: system stats — initSystemStats behaviour', () => {
    it('initSystemStats guards against double-init with _isStatsInit', () => {
        const fn = getFunctionBody(APP_JS, 'initSystemStats');
        assert.match(fn, /_isStatsInit/);
        assert.match(fn, /if\s*\(_isStatsInit\)\s*return/);
    });
    it('initSystemStats calls _loadStaticInfo on first run', () => {
        const fn = getFunctionBody(APP_JS, 'initSystemStats');
        assert.match(fn, /await _loadStaticInfo\(\)/);
    });
    it('initSystemStats applies off-state to sensorToggleBtn when sensors are disabled', () => {
        const fn = getFunctionBody(APP_JS, 'initSystemStats');
        assert.match(fn, /getElementById\('sensorToggleBtn'\)/);
        assert.match(fn, /classList\.add\('off'\)/);
    });
    it('initSystemStats registers focus/blur listeners on window for polling management', () => {
        const fn = getFunctionBody(APP_JS, 'initSystemStats');
        assert.match(fn, /window\.addEventListener\('focus'/);
        assert.match(fn, /window\.addEventListener\('blur'/);
        assert.match(fn, /checkAndManagePolling/);
    });
    it('initSystemStats is scheduled via DOMContentLoaded with a 1000ms delay', () => {
        assert.match(APP_JS, /DOMContentLoaded.*setTimeout\(initSystemStats,\s*1000\)|setTimeout\(initSystemStats,\s*1000\)/);
    });
});

describe('Phase 2.16A: system stats — _loadStaticInfo behaviour', () => {
    it('_loadStaticInfo calls window.electronAPI.getSystemInfo', () => {
        const fn = getFunctionBody(APP_JS, '_loadStaticInfo');
        assert.match(fn, /window\.electronAPI\.getSystemInfo\(\)/);
    });
    it('_loadStaticInfo populates osName, cpuModel, cpuCores, ramTotal, ramSpeed, ramKits', () => {
        const fn = getFunctionBody(APP_JS, '_loadStaticInfo');
        assert.match(fn, /_setText\('osName'/);
        assert.match(fn, /_setText\('cpuModel'/);
        assert.match(fn, /_setText\('cpuCores'/);
        assert.match(fn, /_setText\('ramTotal'/);
        assert.match(fn, /_setText\('ramSpeed'/);
        assert.match(fn, /_setText\('ramKits'/);
    });
    it('_loadStaticInfo populates gpuModel and gpuVram when GPU is present', () => {
        const fn = getFunctionBody(APP_JS, '_loadStaticInfo');
        assert.match(fn, /_setText\('gpuModel'/);
        assert.match(fn, /_setText\('gpuVram'/);
    });
    it('_loadStaticInfo calls _shortName to strip verbose CPU/GPU brand strings', () => {
        const fn = getFunctionBody(APP_JS, '_loadStaticInfo');
        assert.match(fn, /_shortName\(/);
    });
    it('_loadStaticInfo calls _fmtBytes to format RAM and VRAM sizes', () => {
        const fn = getFunctionBody(APP_JS, '_loadStaticInfo');
        assert.match(fn, /_fmtBytes\(/);
    });
    it('_loadStaticInfo wraps the IPC call in try/catch and warns on failure', () => {
        const fn = getFunctionBody(APP_JS, '_loadStaticInfo');
        assert.match(fn, /try/);
        assert.match(fn, /catch/);
        assert.match(fn, /console\.warn/);
    });
});

// ── Section 6: _tickStats behaviour ──────────────────────────────────────────

describe('Phase 2.16A: system stats — _tickStats behaviour', () => {
    it('_tickStats guards against concurrent execution with _isStatsBusy', () => {
        const fn = getFunctionBody(APP_JS, '_tickStats');
        assert.match(fn, /if\s*\(_isStatsBusy\)\s*return/);
        assert.match(fn, /_isStatsBusy\s*=\s*true/);
        assert.match(fn, /_isStatsBusy\s*=\s*false/);
    });
    it('_tickStats calls window.electronAPI.getLiveStats', () => {
        const fn = getFunctionBody(APP_JS, '_tickStats');
        assert.match(fn, /window\.electronAPI\.getLiveStats\(\)/);
    });
    it('_tickStats updates CPU load, bar and temperature', () => {
        const fn = getFunctionBody(APP_JS, '_tickStats');
        assert.match(fn, /_setText\('cpuPercent'/);
        assert.match(fn, /_setBar\('cpuBar'/);
        assert.match(fn, /_setText\('cpuTemp'/);
    });
    it('_tickStats updates RAM percent, bar and used memory', () => {
        const fn = getFunctionBody(APP_JS, '_tickStats');
        assert.match(fn, /_setText\('ramPercent'/);
        assert.match(fn, /_setBar\('ramBar'/);
        assert.match(fn, /_setText\('ramUsed'/);
    });
    it('_tickStats updates network download, upload and ping', () => {
        const fn = getFunctionBody(APP_JS, '_tickStats');
        assert.match(fn, /_setText\('netDown'/);
        assert.match(fn, /_setText\('netUp'/);
        assert.match(fn, /_setText\('netPing'/);
    });
    it('_tickStats updates GPU load, bar and temperature', () => {
        const fn = getFunctionBody(APP_JS, '_tickStats');
        assert.match(fn, /_setText\('gpuPercent'/);
        assert.match(fn, /_setBar\('gpuBar'/);
        assert.match(fn, /_setText\('gpuTemp'/);
    });
    it('_tickStats calculates network speed from _prevNetBytes delta', () => {
        const fn = getFunctionBody(APP_JS, '_tickStats');
        assert.match(fn, /_prevNetBytes/);
        assert.match(fn, /netRxBytes/);
        assert.match(fn, /netTxBytes/);
    });
    it('_tickStats uses _fmtSpeed to format network speeds', () => {
        const fn = getFunctionBody(APP_JS, '_tickStats');
        assert.match(fn, /_fmtSpeed\(/);
    });
    it('_tickStats uses _fmtBytes to format RAM used', () => {
        const fn = getFunctionBody(APP_JS, '_tickStats');
        assert.match(fn, /_fmtBytes\(/);
    });
    it('_tickStats resets _isStatsBusy in a finally block on success and error', () => {
        const fn = getFunctionBody(APP_JS, '_tickStats');
        assert.match(fn, /finally/);
    });
});

// ── Section 7: Formatting helpers behaviour ───────────────────────────────────

describe('Phase 2.16A: system stats — formatting helpers behaviour', () => {
    it('_setText only updates innerText when value differs from current', () => {
        const fn = getFunctionBody(APP_JS, '_setText');
        assert.match(fn, /el\.innerText\s*!==\s*val/);
    });
    it('_setBar caps the width at 100%', () => {
        const fn = getFunctionBody(APP_JS, '_setBar');
        assert.match(fn, /Math\.min\(pct,\s*100\)/);
        assert.match(fn, /el\.style\.width/);
    });
    it('_fmtBytes returns GB for values >= 1e9', () => {
        const fn = getFunctionBody(APP_JS, '_fmtBytes');
        assert.match(fn, /1e9/);
        assert.match(fn, /GB/);
    });
    it('_fmtBytes returns MB for values >= 1e6', () => {
        const fn = getFunctionBody(APP_JS, '_fmtBytes');
        assert.match(fn, /1e6/);
        assert.match(fn, /MB/);
    });
    it('_fmtBytes returns "0 GB" for falsy input', () => {
        const fn = getFunctionBody(APP_JS, '_fmtBytes');
        assert.match(fn, /0 GB/);
    });
    it('_fmtSpeed returns MB/s for speeds >= 1e6', () => {
        const fn = getFunctionBody(APP_JS, '_fmtSpeed');
        assert.match(fn, /1e6/);
        assert.match(fn, /MB\/s/);
    });
    it('_fmtSpeed returns KB/s for lower speeds', () => {
        const fn = getFunctionBody(APP_JS, '_fmtSpeed');
        assert.match(fn, /KB\/s/);
    });
    it('_shortName strips Intel/Core/CPU/NVIDIA GeForce/AMD Radeon brand strings', () => {
        const fn = getFunctionBody(APP_JS, '_shortName');
        assert.match(fn, /Intel/);
        assert.match(fn, /NVIDIA GeForce/);
        assert.match(fn, /AMD Radeon/);
    });
    it('_shortName returns "—" for falsy input', () => {
        const fn = getFunctionBody(APP_JS, '_shortName');
        assert.match(fn, /return '—'/);
    });
    it('_resetStatsUI zeroes CPU, GPU, RAM and network fields', () => {
        const fn = getFunctionBody(APP_JS, '_resetStatsUI');
        assert.match(fn, /_setText\('cpuPercent'/);
        assert.match(fn, /_setText\('gpuPercent'/);
        assert.match(fn, /_setText\('ramPercent'/);
        assert.match(fn, /_setText\('netDown'/);
    });
});

// ── Section 8: Footer playtime stats behaviour ────────────────────────────────

describe('Phase 2.16A: system stats — footer playtime stats behaviour', () => {
    it('updateFooterStats reads allGamesData.length for games count', () => {
        const fn = getFunctionBody(APP_JS, 'updateFooterStats');
        assert.match(fn, /allGamesData\.length/);
        assert.match(fn, /getElementById\('gamesCount'\)/);
    });
    it('updateFooterStats reads playtimeData to compute total playtime', () => {
        const fn = getFunctionBody(APP_JS, 'updateFooterStats');
        assert.match(fn, /\bplaytimeData\b/);
    });
    it('updateFooterStats uses currentPlaytimeFilterValue to apply date filter', () => {
        const fn = getFunctionBody(APP_JS, 'updateFooterStats');
        assert.match(fn, /currentPlaytimeFilterValue/);
    });
    it('updateFooterStats supports today, week, month, year and all filters', () => {
        const fn = getFunctionBody(APP_JS, 'updateFooterStats');
        assert.match(fn, /'today'/);
        assert.match(fn, /'week'/);
        assert.match(fn, /'month'/);
        assert.match(fn, /'year'/);
        assert.match(fn, /'all'/);
    });
    it('updateFooterStats displays time as "Xh Ym" in totalLifePlaytime element', () => {
        const fn = getFunctionBody(APP_JS, 'updateFooterStats');
        assert.match(fn, /getElementById\('totalLifePlaytime'\)/);
        assert.match(fn, /hours/);
        assert.match(fn, /mins/);
    });
    it('cyclePlaytimeFormat increments currentPlaytimeFormat with wrap-around at 5', () => {
        const fn = getFunctionBody(APP_JS, 'cyclePlaytimeFormat');
        assert.match(fn, /currentPlaytimeFormat\s*=\s*\(currentPlaytimeFormat\s*\+\s*1\)\s*%\s*5/);
    });
    it('cyclePlaytimeFormat calls updateFooterStats after incrementing', () => {
        const fn = getFunctionBody(APP_JS, 'cyclePlaytimeFormat');
        assert.match(fn, /updateFooterStats\(\)/);
    });
    it('togglePlaytimeDropdown toggles playtimeMenu active class', () => {
        const fn = getFunctionBody(APP_JS, 'togglePlaytimeDropdown');
        assert.match(fn, /getElementById\('playtimeMenu'\)/);
        assert.match(fn, /classList\.toggle\('active'\)/);
    });
    it('selectPlaytime updates selectedPlaytimeText and currentPlaytimeFilterValue', () => {
        const fn = getFunctionBody(APP_JS, 'selectPlaytime');
        assert.match(fn, /getElementById\('selectedPlaytimeText'\)/);
        assert.match(fn, /currentPlaytimeFilterValue\s*=\s*value/);
    });
    it('selectPlaytime closes playtimeMenu and calls updateFooterStats', () => {
        const fn = getFunctionBody(APP_JS, 'selectPlaytime');
        assert.match(fn, /playtimeMenu.*remove.*active|classList\.remove\('active'\)/);
        assert.match(fn, /updateFooterStats\(\)/);
    });
});

// ── Section 9: DOM IDs in dashboard.html ─────────────────────────────────────

describe('Phase 2.16A: system stats — DOM IDs in dashboard.html', () => {
    it('sysLiveDot element exists', () => { assert.match(HTML, /id="sysLiveDot"/); });
    it('sensorToggleBtn element exists', () => { assert.match(HTML, /id="sensorToggleBtn"/); });
    it('sensorToggleText element exists', () => { assert.match(HTML, /id="sensorToggleText"/); });
    it('cpuPercent element exists', () => { assert.match(HTML, /id="cpuPercent"/); });
    it('cpuBar element exists', () => { assert.match(HTML, /id="cpuBar"/); });
    it('cpuTemp element exists', () => { assert.match(HTML, /id="cpuTemp"/); });
    it('cpuModel element exists', () => { assert.match(HTML, /id="cpuModel"/); });
    it('cpuCores element exists', () => { assert.match(HTML, /id="cpuCores"/); });
    it('gpuPercent element exists', () => { assert.match(HTML, /id="gpuPercent"/); });
    it('gpuBar element exists', () => { assert.match(HTML, /id="gpuBar"/); });
    it('gpuTemp element exists', () => { assert.match(HTML, /id="gpuTemp"/); });
    it('gpuModel element exists', () => { assert.match(HTML, /id="gpuModel"/); });
    it('gpuVram element exists', () => { assert.match(HTML, /id="gpuVram"/); });
    it('ramPercent element exists', () => { assert.match(HTML, /id="ramPercent"/); });
    it('ramBar element exists', () => { assert.match(HTML, /id="ramBar"/); });
    it('ramUsed element exists', () => { assert.match(HTML, /id="ramUsed"/); });
    it('ramTotal element exists', () => { assert.match(HTML, /id="ramTotal"/); });
    it('ramSpeed element exists', () => { assert.match(HTML, /id="ramSpeed"/); });
    it('ramKits element exists', () => { assert.match(HTML, /id="ramKits"/); });
    it('netDown element exists', () => { assert.match(HTML, /id="netDown"/); });
    it('netUp element exists', () => { assert.match(HTML, /id="netUp"/); });
    it('netPing element exists', () => { assert.match(HTML, /id="netPing"/); });
    it('osName element exists', () => { assert.match(HTML, /id="osName"/); });
    it('gamesCount element exists', () => { assert.match(HTML, /id="gamesCount"/); });
    it('totalLifePlaytime element exists', () => { assert.match(HTML, /id="totalLifePlaytime"/); });
    it('selectedPlaytimeText element exists', () => { assert.match(HTML, /id="selectedPlaytimeText"/); });
    it('playtimeMenu element exists', () => { assert.match(HTML, /id="playtimeMenu"/); });
    it('sensorToggleBtn calls toggleSensors via inline onclick', () => {
        assert.match(HTML, /onclick="toggleSensors\(\)"/);
    });
    it('playtime dropdown trigger calls togglePlaytimeDropdown via inline onclick', () => {
        assert.match(HTML, /onclick="togglePlaytimeDropdown\(event\)"/);
    });
    it('selectPlaytime is called with value/text pairs from dropdown items', () => {
        assert.match(HTML, /onclick="selectPlaytime\('all'/);
        assert.match(HTML, /onclick="selectPlaytime\('today'/);
    });
});

// ── Section 10: electronAPI dependencies ─────────────────────────────────────

describe('Phase 2.16A: system stats — electronAPI dependencies', () => {
    it('_loadStaticInfo depends on window.electronAPI.getSystemInfo', () => {
        const fn = getFunctionBody(APP_JS, '_loadStaticInfo');
        assert.match(fn, /window\.electronAPI\.getSystemInfo/);
    });
    it('_tickStats depends on window.electronAPI.getLiveStats', () => {
        const fn = getFunctionBody(APP_JS, '_tickStats');
        assert.match(fn, /window\.electronAPI\.getLiveStats/);
    });
    it('toggleSensors depends on window.electronAPI.logHudSensorToggled', () => {
        const fn = getFunctionBody(APP_JS, 'toggleSensors');
        assert.match(fn, /window\.electronAPI\.logHudSensorToggled/);
    });
});

// ── Section 11: Intentional dependencies ─────────────────────────────────────

describe('Phase 2.16A: system stats — intentional dependencies', () => {
    it('checkAndManagePolling depends on currentView', () => {
        const fn = getFunctionBody(APP_JS, 'checkAndManagePolling');
        assert.match(fn, /\bcurrentView\b/);
    });
    it('updateFooterStats depends on allGamesData', () => {
        const fn = getFunctionBody(APP_JS, 'updateFooterStats');
        assert.match(fn, /\ballGamesData\b/);
    });
    it('updateFooterStats depends on playtimeData', () => {
        const fn = getFunctionBody(APP_JS, 'updateFooterStats');
        assert.match(fn, /\bplaytimeData\b/);
    });
    it('isSensorEnabled persists to localStorage key baddel_sensors_enabled', () => {
        assert.match(APP_JS, /baddel_sensors_enabled/);
    });
    it('initSystemStats calls checkAndManagePolling during setup', () => {
        const fn = getFunctionBody(APP_JS, 'initSystemStats');
        assert.match(fn, /checkAndManagePolling\(\)/);
    });
    it('navigateToHome in app.js calls updateFooterStats', () => {
        const fn = getFunctionBody(APP_JS, 'navigateToHome');
        assert.match(fn, /updateFooterStats\(\)/);
    });
    it('navigateToHome in app.js calls checkAndManagePolling via typeof guard', () => {
        const fn = getFunctionBody(APP_JS, 'navigateToHome');
        assert.match(fn, /checkAndManagePolling/);
    });
    it('applyFilters in app.js calls updateFooterStats', () => {
        const fn = getFunctionBody(APP_JS, 'applyFilters');
        assert.match(fn, /updateFooterStats\(\)/);
    });
    it('applyFilters in app.js calls checkAndManagePolling via typeof guard', () => {
        const fn = getFunctionBody(APP_JS, 'applyFilters');
        assert.match(fn, /checkAndManagePolling/);
    });
});

// ── Section 12: Dependency isolation ─────────────────────────────────────────

describe('Phase 2.16A: system stats — dependency isolation', () => {
    it('_tickStats does not reference currentAccountPlatform', () => {
        const fn = getFunctionBody(APP_JS, '_tickStats');
        assert.doesNotMatch(fn, /\bcurrentAccountPlatform\b/);
    });
    it('_tickStats does not reference activePlatformView', () => {
        const fn = getFunctionBody(APP_JS, '_tickStats');
        assert.doesNotMatch(fn, /\bactivePlatformView\b/);
    });
    it('_tickStats does not reference renderPlatformAccounts', () => {
        const fn = getFunctionBody(APP_JS, '_tickStats');
        assert.doesNotMatch(fn, /\brenderPlatformAccounts\b/);
    });
    it('_tickStats does not reference AG_DISPLAY_DEFAULTS', () => {
        const fn = getFunctionBody(APP_JS, '_tickStats');
        assert.doesNotMatch(fn, /\bAG_DISPLAY_DEFAULTS\b/);
    });
    it('checkAndManagePolling does not reference currentAccountPlatform', () => {
        const fn = getFunctionBody(APP_JS, 'checkAndManagePolling');
        assert.doesNotMatch(fn, /\bcurrentAccountPlatform\b/);
    });
    it('checkAndManagePolling does not reference AG_DISPLAY_DEFAULTS', () => {
        const fn = getFunctionBody(APP_JS, 'checkAndManagePolling');
        assert.doesNotMatch(fn, /\bAG_DISPLAY_DEFAULTS\b/);
    });
    it('toggleSensors does not reference currentAccountPlatform', () => {
        const fn = getFunctionBody(APP_JS, 'toggleSensors');
        assert.doesNotMatch(fn, /\bcurrentAccountPlatform\b/);
    });
    it('updateFooterStats does not reference currentAccountPlatform', () => {
        const fn = getFunctionBody(APP_JS, 'updateFooterStats');
        assert.doesNotMatch(fn, /\bcurrentAccountPlatform\b/);
    });
    it('updateFooterStats does not reference activePlatformView', () => {
        const fn = getFunctionBody(APP_JS, 'updateFooterStats');
        assert.doesNotMatch(fn, /\bactivePlatformView\b/);
    });
    it('updateFooterStats does not reference window._agDisplayPrefs', () => {
        const fn = getFunctionBody(APP_JS, 'updateFooterStats');
        assert.doesNotMatch(fn, /window\._agDisplayPrefs/);
    });
    it('updateFooterStats does not reference IG_DISPLAY_DEFAULTS', () => {
        const fn = getFunctionBody(APP_JS, 'updateFooterStats');
        assert.doesNotMatch(fn, /\bIG_DISPLAY_DEFAULTS\b/);
    });
});
