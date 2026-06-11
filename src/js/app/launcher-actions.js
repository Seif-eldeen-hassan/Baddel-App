// ── Launcher / game action functions ─────────────────────────────────────────
// Manages isLaunching state and the functions that trigger or close game launch.
// Loads before hero.js and app.js so that isLaunching is available in the
// shared Global Declarative Environment Record when those files reference it.

let isLaunching = false;

async function triggerLaunchSequence(gameId) {
    if (isLaunching) return;

    const game = allGamesData.find(g => String(g.id) === String(gameId));
    if (!game) return;

    // Delegate to play-launcher.js modal when available (handles platform/account selection)
    if (typeof window.openPlayLauncher === 'function') {
        window.openPlayLauncher(game);
        return;
    }

    // Fallback path when play-launcher.js is not loaded
    isLaunching = true;

    const overlay = document.getElementById('launchOverlay');
    const bgDiv = document.getElementById('launchBg');
    const logoImg = document.getElementById('launchLogo');
    const titleTxt = document.getElementById('launchTitle');
    const statusText = document.getElementById('launchText');

    logoImg.style.display = 'none'; logoImg.src = '';
    titleTxt.style.display = 'none'; statusText.innerText = 'INITIALIZING...';

    const bgUrl = game.heroImage || game.image || 'assets/default_hero.jpg';
    if (bgUrl) bgDiv.style.backgroundImage = `url('${bgUrl.replace(/\\/g, '/')}')`;

    if (game.logo) { logoImg.src = game.logo; logoImg.style.display = 'block'; }
    else { titleTxt.innerText = game.name; titleTxt.style.display = 'block'; }

    statusText.innerText = `STARTING ${game.name.toUpperCase()}...`;
    overlay.classList.add('active');

    let trackPath = game.path;
    if (!trackPath && game.command) {
        const cleanCommand = game.command.replace(/"/g, '');
        trackPath = cleanCommand.substring(0, cleanCommand.lastIndexOf('\\'));
    }

    try {
        const launchRes = await window.electronAPI.launchGame(game.command, game.id, trackPath, game.name);
        if (launchRes && launchRes.status === 'error') {
            console.error('[Launch] failed code=' + launchRes.code + ' msg=' + launchRes.message, launchRes.diagnostics || '');
            throw new Error(launchRes.message);
        }
    } catch (e) {
        const hint = e?.message?.includes('not found') || e?.message?.includes('NOT_FOUND')
            ? 'Game file not found — check the installation path.'
            : 'Error starting game! Make sure it\'s installed.';
        showToast(hint, 'error');
        overlay.classList.remove('active');
        isLaunching = false;
        return;
    }

    const finish = () => {
        window.electronAPI.minimizeApp();
        setTimeout(() => { overlay.classList.remove('active'); isLaunching = false; }, 400);
    };

    const onFocus = () => { finish(); window.removeEventListener('focus', onFocus); };
    window.addEventListener('focus', onFocus);
    setTimeout(() => { if (isLaunching) { finish(); window.removeEventListener('focus', onFocus); } }, 8000);
}

function triggerPlay() { if (selectedGameId) triggerLaunchSequence(selectedGameId); hideContextMenu(); }

function closeGameSettings() {
    pendingImageChanges = {};
    document.getElementById('gameSettingsModal').classList.remove('active');
    selectedGameId = null;
}

// Explicit window exports so inline onclick handlers and cross-file calls resolve correctly
window.triggerLaunchSequence = triggerLaunchSequence;
window.triggerPlay           = triggerPlay;
window.closeGameSettings     = closeGameSettings;
