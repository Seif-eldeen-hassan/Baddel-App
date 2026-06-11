// ── System stats HUD and footer playtime stats ───────────────────────────────
// Polling, sensor toggle, and HUD rendering for the Home view stats panel.
// Footer playtime aggregation also lives here.
// Loads before app.js; bare-name references to currentView, allGamesData, and
// playtimeData resolve at call time via the shared Global Declarative Environment
// Record — these vars are always initialized before any of these functions are
// called.

let _prevNetBytes = { rx: 0, tx: 0, ts: 0 };
let _hudInterval = null;
let _isStatsInit = false;
let _isStatsBusy = false;

let isSensorEnabled = localStorage.getItem('baddel_sensors_enabled') !== 'false';

function checkAndManagePolling() {
    const isHomeView = (currentView === 'home');
    const hasFocus = document.hasFocus();
    const liveDot = document.getElementById('sysLiveDot');

    if (isSensorEnabled && hasFocus && isHomeView) {
        if (!_hudInterval) {
            _hudInterval = setInterval(_tickStats, 3000);
            _tickStats();
            if (liveDot) liveDot.style.opacity = '1';
        }
    } else {
        if (_hudInterval) {
            clearInterval(_hudInterval);
            _hudInterval = null;
            if (liveDot) liveDot.style.opacity = '0.3';
        }
    }
}

function toggleSensors() {
    isSensorEnabled = !isSensorEnabled;
    localStorage.setItem('baddel_sensors_enabled', isSensorEnabled);

    const btn = document.getElementById('sensorToggleBtn');
    const txt = document.getElementById('sensorToggleText');

    window.electronAPI.logHudSensorToggled?.(isSensorEnabled);

    if (isSensorEnabled) {
        if (btn) btn.classList.remove('off');
        if (txt) txt.innerText = 'SENSORS: ON';
        _tickStats();
    } else {
        if (btn) btn.classList.add('off');
        if (txt) txt.innerText = 'SENSORS: OFF';
        _resetStatsUI();
    }

    checkAndManagePolling();
}

function _resetStatsUI() {
    _setText('cpuPercent', '0%'); _setBar('cpuBar', 0); _setText('cpuTemp', 'N/A');
    _setText('gpuPercent', '0%'); _setBar('gpuBar', 0); _setText('gpuTemp', 'N/A');
    _setText('ramPercent', '0%'); _setBar('ramBar', 0); _setText('ramUsed', '0 GB');
    _setText('netDown', '0 KB/s'); _setText('netUp', '0 KB/s'); _setText('netPing', '0 ms');
}

async function initSystemStats() {
    if (_isStatsInit) return;
    _isStatsInit = true;
    await _loadStaticInfo();
    const btn = document.getElementById('sensorToggleBtn');
    const txt = document.getElementById('sensorToggleText');
    if (!isSensorEnabled && btn) {
        btn.classList.add('off');
        txt.innerText = 'SENSORS: OFF';
        _resetStatsUI();
    }

    checkAndManagePolling();
    window.addEventListener('focus', checkAndManagePolling);
    window.addEventListener('blur', checkAndManagePolling);
}


async function _loadStaticInfo() {
    try {
        const info = await window.electronAPI.getSystemInfo();
        _setText('osName', info.osName || '—');
        _setText('cpuModel', _shortName(info.cpuModel));
        _setText('cpuCores', `${info.cpuCores} Cores`);
        _setText('ramTotal', `${_fmtBytes(info.totalRam)} Total`);
        _setText('ramSpeed', info.ramSpeed || '—');
        _setText('ramKits', info.ramKitsStr ? `Kits: ${info.ramKitsStr}` : 'Kits: —');
        if (info.gpuModel && info.gpuModel !== '—') {
            _setText('gpuModel', _shortName(info.gpuModel));
            if (info.gpuVram > 0) _setText('gpuVram', `${_fmtBytes(info.gpuVram)} VRAM`);
        } else {
            _setText('gpuModel', 'Integrated');
        }
    } catch (e) { console.warn('Static info error:', e); }
}

async function _tickStats() {
    if (_isStatsBusy) return;
    _isStatsBusy = true;
    try {
        const stats = await window.electronAPI.getLiveStats();
        if (!stats || Object.keys(stats).length === 0) return;

        const cpuPct = stats.cpuLoad || 0;
        _setText('cpuPercent', `${cpuPct}%`);
        _setBar('cpuBar', cpuPct);
        _setText('cpuTemp', stats.cpuTemp ? `${stats.cpuTemp}°C` : 'N/A');

        const ramUsed = stats.usedRam || 0;
        const ramTotal = stats.totalRam || 1;
        const ramPct = Math.round((ramUsed / ramTotal) * 100);
        _setText('ramPercent', `${ramPct}%`);
        _setBar('ramBar', ramPct);
        _setText('ramUsed', _fmtBytes(ramUsed));

        const now = Date.now();
        const rx = stats.netRxBytes || 0;
        const tx = stats.netTxBytes || 0;
        const dt = _prevNetBytes.ts ? (now - _prevNetBytes.ts) / 1000 : 1;
        const down = _prevNetBytes.ts ? Math.max(0, (rx - _prevNetBytes.rx) / dt) : 0;
        const up = _prevNetBytes.ts ? Math.max(0, (tx - _prevNetBytes.tx) / dt) : 0;
        _prevNetBytes = { rx, tx, ts: now };

        _setText('netDown', _fmtSpeed(down));
        _setText('netUp', _fmtSpeed(up));
        _setText('netPing', `${stats.ping || 0} ms`);

        _setText('gpuPercent', `${stats.gpuLoad || 0}%`);
        _setBar('gpuBar', stats.gpuLoad || 0);
        _setText('gpuTemp', stats.gpuTemp ? `${stats.gpuTemp}°C` : '32°C');
    } catch (e) {
        console.error('Stats Tick Error:', e);
    } finally {
        _isStatsBusy = false;
    }
}

function _setText(id, val) { const el = document.getElementById(id); if (el && el.innerText !== val) el.innerText = val; }
function _setBar(id, pct) { const el = document.getElementById(id); if (el) el.style.width = `${Math.min(pct, 100)}%`; }
function _fmtBytes(b) {
    if (!b) return '0 GB';
    if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB';
    if (b >= 1e6) return (b / 1e6).toFixed(0) + ' MB';
    return '0 GB';
}
function _fmtSpeed(bps) {
    if (bps >= 1e6) return (bps / 1e6).toFixed(1) + ' MB/s';
    return (bps / 1e3).toFixed(0) + ' KB/s';
}
function _shortName(name) {
    if (!name) return '—';
    return name.replace(/Intel\(R\)|Core\(TM\)|CPU|NVIDIA GeForce|AMD Radeon/gi, '').replace(/\s+/g, ' ').trim();
}

document.addEventListener('DOMContentLoaded', () => setTimeout(initSystemStats, 1000));

// ── Footer playtime stats ─────────────────────────────────────────────────────

let currentPlaytimeFormat = 0;
let currentPlaytimeFilterValue = 'all';

function cyclePlaytimeFormat() {
    currentPlaytimeFormat = (currentPlaytimeFormat + 1) % 5;
    updateFooterStats();
}

function togglePlaytimeDropdown(e) {
    if (e) e.stopPropagation();
    document.getElementById('playtimeMenu').classList.toggle('active');
}

function selectPlaytime(value, text) {
    document.getElementById('selectedPlaytimeText').innerText = text;
    currentPlaytimeFilterValue = value;
    document.getElementById('playtimeMenu').classList.remove('active');
    updateFooterStats();
}

function updateFooterStats() {
    const countEl = document.getElementById('gamesCount');
    if (countEl) countEl.innerText = `${allGamesData.length} Games Installed`;

    const filterType = currentPlaytimeFilterValue;
    let totalMins = 0;

    const now = new Date();
    now.setHours(0, 0, 0, 0);

    for (const id in playtimeData) {
        const gameData = playtimeData[id];
        if (filterType === 'all') {
            totalMins += gameData.totalMinutes || 0;
        } else {
            const sessions = gameData.playSessions || [];
            sessions.forEach(session => {
                if (!session.date) return;
                const [year, month, day] = session.date.split('-');
                const sessionDate = new Date(year, month - 1, day);
                sessionDate.setHours(0, 0, 0, 0);
                const diffDays = Math.floor((now - sessionDate) / (1000 * 60 * 60 * 24));
                if (filterType === 'today' && diffDays === 0) totalMins += session.minutes;
                else if (filterType === 'week' && diffDays <= 7 && diffDays >= 0) totalMins += session.minutes;
                else if (filterType === 'month' && diffDays <= 30 && diffDays >= 0) totalMins += session.minutes;
                else if (filterType === 'year' && diffDays <= 365 && diffDays >= 0) totalMins += session.minutes;
            });
        }
    }

    const hours = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    const timeStr = totalMins > 0 ? `${hours}h ${mins}m` : '0h 0m';

    const timeEl = document.getElementById('totalLifePlaytime');
    if (timeEl) timeEl.innerText = timeStr;
}

// Explicit window exports so inline onclick handlers and cross-file calls resolve correctly
window.checkAndManagePolling  = checkAndManagePolling;
window.toggleSensors          = toggleSensors;
window.initSystemStats        = initSystemStats;
window.updateFooterStats      = updateFooterStats;
window.togglePlaytimeDropdown = togglePlaytimeDropdown;
window.selectPlaytime         = selectPlaytime;
window.cyclePlaytimeFormat    = cyclePlaytimeFormat;
