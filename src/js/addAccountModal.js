// ============================================================
// BADDEL LAUNCHER - ADD ACCOUNT MODAL SYSTEM
// addAccountModal.js
// ============================================================

// ---- Storage Keys ----
const DONT_ASK_KEYS = {
    steam:   'baddel_dontAsk_add_steam',
    epic:    'baddel_dontAsk_add_epic',
    ea:      'baddel_dontAsk_add_ea',
    riot:    'baddel_dontAsk_add_riot',
    ubisoft: 'baddel_dontAsk_add_ubisoft',
    discord: 'baddel_dontAsk_add_discord',
    rockstar: 'baddel_dontAsk_add_rockstar' // 🔴 السطر الجديد
};

// ---- Custom Modal Logos (Matching Sidebar Images) ----
const MODAL_LOGOS = {
    steam: `<img src="../assets/Steam.png" alt="Steam" style="width: 32px; height: 32px; object-fit: contain;">`,
    epic: `<img src="../assets/epic.svg" class="invert-on-dark" alt="Epic" style="width: 32px; height: 32px; object-fit: contain; filter: brightness(0) invert(1) drop-shadow(0 1px 2px rgba(255,255,255,0.3));">`,
    ea: `<img src="../assets/ea.png" alt="EA" style="width: 34px; height: 34px; object-fit: contain;">`,
    riot: `<img src="../assets/riot.png" alt="Riot" style="width: 34px; height: 34px; object-fit: contain;">`,
    ubisoft: `<img src="../assets/ubisoft.png" alt="Ubisoft" style="width: 32px; height: 32px; object-fit: contain; filter: brightness(0) invert(1) drop-shadow(0 1px 2px rgba(255,255,255,0.3));">`,
    discord: `<svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor"><path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/></svg>`,
    rockstar: `<img src="../assets/rockstar.png" alt="Rockstar" style="width: 32px; height: 32px; object-fit: contain;">` 
};

// ---- Platform Step Configs ----
const ADD_ACCOUNT_STEPS = {
    steam: {
        accent: '#1381b2',
        accentDark: '#1b2838',
        willSignOut: true,
        signOutNote: 'Steam will sign you out of your current account before the login screen appears.',
        steps: [
            {
                icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.029 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.607 0 11.979 0z" fill="currentColor"/></svg>`,
                title: 'Steam Opens',
                desc: 'Baddel will launch Steam. It will automatically sign out your current account and show the login screen.',
            },
            {
                icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`,
                title: 'Sign In to New Account',
                desc: 'Enter the credentials for the new account you want to add. Make sure to check "Remember Me".',
            },
            {
                icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>`,
                title: 'Save Current is Done Automatically',
                desc: 'Once Steam opens and you\'re signed in, Baddel will detect and save the account for you. No extra steps needed!',
            },
        ],
        warning: `Do NOT sign out manually from Steam — Baddel handles everything. Signing out yourself may corrupt the saved session.`,
    },

    epic: {
        accent: '#ffffff',
        accentDark: '#0f0f0f',
        willSignOut: true,
        signOutNote: 'Epic Games Launcher will sign you out of your current account.',
        steps: [
            {
                icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M3 1.5v21L9 21V9h6v4.5h-3V16.5h3V21l6 1.5V1.5H3zm15 10.5h-3V7.5h3V12z"/></svg>`,
                title: 'Epic Games Launcher Opens',
                desc: 'Baddel will launch the Epic Games Launcher. It will open to the login screen after signing out.',
            },
            {
                icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`,
                title: 'Sign In to New Account',
                desc: 'Log in with the credentials for the new Epic account you want to save.',
            },
            {
                icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>`,
                title: 'Come Back & Click "Save Current"',
                desc: 'Once you\'re signed in and the launcher is open, come back to Baddel and click the "Save Current" button to save this account.',
            },
        ],
        warning: `Do NOT sign out from Epic manually. Always use Baddel to switch accounts to avoid losing saved sessions.`,
    },

    ea: {
        accent: '#fe4846',
        accentDark: '#1a0800',
        willSignOut: true,
        signOutNote: 'EA App will sign you out of your current account.',
        steps: [
            {
                icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M5.987 5.987A9.052 9.052 0 0 0 3 12a9 9 0 0 0 9 9 9.052 9.052 0 0 0 6.013-2.987L5.987 5.987zm1.006-1.006 13.02 13.02A9.052 9.052 0 0 0 21 12a9 9 0 0 0-9-9 9.052 9.052 0 0 0-6.007 2.981zM0 12C0 5.373 5.373 0 12 0s12 5.373 12 12-5.373 12-12 12S0 18.627 0 12z"/></svg>`,
                title: 'EA App Opens',
                desc: 'Baddel will launch the EA App and bring it to the login screen.',
            },
            {
                icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`,
                title: 'Sign In to New Account',
                desc: 'Enter your EA account credentials and log in.',
            },
            {
                icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>`,
                title: 'Come Back & Click "Save Current"',
                desc: 'Once you\'re logged in, return to Baddel and click "Save Current" to register this account.',
            },
        ],
        warning: `Never manually sign out from EA App — use Baddel's switch feature to protect your saved sessions.`,
    },

    ubisoft: {
        accent: '#00a8ff',
        accentDark: '#001a2e',
        willSignOut: true,
        signOutNote: 'Ubisoft Connect will sign you out of your current account.',
        steps: [
            {
                icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12.003 0C6.813 0 2.247 3.237.633 8.187a1.016 1.016 0 0 0 .985 1.332c.43 0 .82-.272.963-.68 1.363-4.181 5.297-6.993 9.72-6.993 2.833 0 5.498 1.104 7.501 3.107 2.004 2.004 3.107 4.668 3.107 7.5 0 5.843-4.75 10.601-10.593 10.601-4.398 0-8.33-2.795-9.72-6.954a1.017 1.017 0 0 0-1.283-.657 1.017 1.017 0 0 0-.664 1.28C2.27 20.771 6.822 24 12.003 24c6.617 0 12-5.384 12-12.003 0-3.206-1.25-6.223-3.52-8.493C18.212 1.244 15.2 0 12.003 0z"/></svg>`,
                title: 'Ubisoft Connect Opens',
                desc: 'Baddel will launch Ubisoft Connect and sign you out to show the login screen.',
            },
            {
                icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`,
                title: 'Sign In to New Account',
                desc: 'Enter your Ubisoft credentials and complete the login.',
            },
            {
                icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>`,
                title: 'Come Back & Click "Save Current"',
                desc: 'Return to Baddel and click "Save Current" to store this Ubisoft account.',
            },
        ],
        warning: `Don't sign out from Ubisoft Connect manually — let Baddel handle account switching to keep sessions intact.`,
    },

    discord: {
        accent: '#5865F2',
        accentDark: '#0e0f1a',
        willSignOut: true,
        signOutNote: 'Discord will sign you out of your current account.',
        steps: [
            {
                icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/></svg>`,
                title: 'Discord Opens',
                desc: 'Baddel will launch Discord and bring up the login screen.',
            },
            {
                icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`,
                title: 'Sign In to New Account',
                desc: 'Enter your Discord credentials and log in.',
            },
            {
                icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>`,
                title: 'Come Back & Click "Save Current"',
                desc: 'Return to Baddel and hit "Save Current" to store this Discord account.',
            },
        ],
        warning: `Never sign out from Discord manually — Baddel's switch feature keeps your sessions safe.`,
    },

    riot: {
        accent: '#d32f2e',
        accentDark: '#1a0007',
        willSignOut: false,
        signOutNote: null,
        steps: [
            {
                icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12.534 21.77l-1.09-2.81 8.243.518L24 21.77H12.534zm-3.752-4.144L5.044 5.408 0 21.77h4.195l1.56-4.144h3.027zm2.868-7.37l1.704 4.326H9.945l1.705-4.326zM13.98 2.23l-1.98 5.06-1.981-5.06H5.862L12 18.19 18.138 2.23H13.98z"/></svg>`,
                title: 'Riot Client Opens',
                desc: 'Baddel will open the Riot Client and show the login screen.',
            },
            {
                icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`,
                title: 'Sign In to New Account',
                desc: 'Log in with the Riot account credentials you want to add.',
            },
            {
                icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
                title: 'Close Riot Client Completely',
                desc: 'After logging in, you MUST fully close the Riot Client — including from the system tray (right-click the tray icon → Quit). Do not leave it running in the background.',
            },
            {
                icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>`,
                title: 'Come Back & Click "Save Current"',
                desc: 'Once Riot is fully closed, return to Baddel and click "Save Current" to save this account.',
            },
        ],
        warning: `Riot Client MUST be fully closed (including from the tray) before saving. If it's still running, the save will fail. Also, never sign out manually from Riot — always use Baddel.`,
        riotSpecial: true,
    },

    rockstar: {
        accent: '#fcaf17',
        accentDark: '#1a1100',
        willSignOut: true,
        signOutNote: 'Rockstar Launcher will sign you out of your current account.',
        steps: [
            {
                icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L2 22h20L12 2z"/></svg>`,
                title: 'Rockstar Launcher Opens',
                desc: 'Baddel will open Rockstar Launcher and show the login screen.',
            },
            {
                icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`,
                title: 'Sign In to New Account',
                desc: 'Log in and check "Remember Me".',
            },
            {
                icon: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>`,
                title: 'Close and Save',
                desc: 'Close the launcher completely from the system tray, then return to Baddel and click Save.',
            },
        ],
        warning: `You must close Rockstar Launcher from the system tray completely before saving.`,
    },
};

// ============================================================
// MAIN FUNCTION: showAddAccountModal
// ============================================================

/**
 * showAddAccountModal
 * @param {string} platform - 'steam' | 'epic' | 'ea' | 'riot' | 'ubisoft' | 'discord'
 * @param {Function} onConfirm - callback لما اليوزر يضغط "Got it, Let's Go"
 */
function showAddAccountModal(platform, onConfirm) {
    if (document.getElementById('addAccountModalOverlay')) return;
    const dontAskKey = DONT_ASK_KEYS[platform];
    
    if (dontAskKey && localStorage.getItem(dontAskKey) === '1') {
        onConfirm();
        return;
    }

    const cfg = PLATFORM_CONFIG[platform];
    const stepCfg = ADD_ACCOUNT_STEPS[platform];
    if (!cfg || !stepCfg) { onConfirm(); return; }

    const realLogoHTML = MODAL_LOGOS[platform] || cfg.logo;

    const overlay = document.createElement('div');
    overlay.id = 'addAccountModalOverlay';
    overlay.style.cssText = `
        position: fixed; inset: 0; z-index: 10000;
        background: rgba(0,0,0,0.85);
        display: flex; align-items: center; justify-content: center;
        backdrop-filter: blur(6px);
        animation: aamOverlayIn 0.2s ease;
    `;

    if (!document.getElementById('aamKeyframes')) {
        const style = document.createElement('style');
        style.id = 'aamKeyframes';
        style.textContent = `
            @keyframes aamOverlayIn { from { opacity: 0; } to { opacity: 1; } }
            @keyframes aamBoxIn { from { opacity: 0; transform: scale(0.94) translateY(10px); } to { opacity: 1; transform: scale(1) translateY(0); } }
            @keyframes aamStepIn { from { opacity: 0; transform: translateX(10px); } to { opacity: 1; transform: translateX(0); } }
            .aam-step-dot { transition: background 0.3s, transform 0.3s; }
            .aam-step-item { animation: aamStepIn 0.3s ease both; }
            .aam-step-item:nth-child(1) { animation-delay: 0.05s; }
            .aam-step-item:nth-child(2) { animation-delay: 0.10s; }
            .aam-step-item:nth-child(3) { animation-delay: 0.15s; }
            .aam-step-item:nth-child(4) { animation-delay: 0.20s; }
            .aam-confirm-btn:active { transform: scale(0.97); }
            .aam-confirm-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none !important; }
            .aam-confirm-btn:active { transform: scale(0.97); }
            .aam-confirm-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none !important; }
                .aam-custom-checkbox {
                appearance: none; -webkit-appearance: none;
                width: 18px; height: 18px; flex-shrink: 0; margin: 0;
                border: 2px solid rgba(255,255,255,0.2); border-radius: 5px;
                background: rgba(0,0,0,0.3); cursor: pointer;
                position: relative; transition: all 0.2s ease;
            }
            .aam-custom-checkbox:hover { border-color: rgba(255,255,255,0.4); }
            .aam-custom-checkbox:checked { border-color: var(--chk-accent); background: var(--chk-accent); }
            .aam-custom-checkbox:checked::after {
                content: ''; position: absolute;
                left: 5px; top: 1px; width: 4px; height: 9px;
                border: solid var(--chk-color); border-width: 0 2px 2px 0;
                transform: rotate(45deg);
            }
        `;
        document.head.appendChild(style);
    }

    const accent = stepCfg.accent;
    const isLight = accent === '#ffffff';
    const btnTextColor = isLight ? '#000' : '#fff';

    const stepsHTML = stepCfg.steps.map((step, i) => `
        <div class="aam-step-item" style="
            display: flex; gap: 14px; align-items: flex-start;
            padding: 14px 16px;
            background: rgba(255,255,255,0.03);
            border: 1px solid rgba(255,255,255,0.06);
            border-radius: 10px;
        ">
            <div style="
                width: 38px; height: 38px; flex-shrink: 0;
                display: flex; align-items: center; justify-content: center;
                color: ${accent};
            ">
                ${i === 0 ? realLogoHTML : step.icon}
            </div>
            <div>
                <div style="
                    display: flex; align-items: center; gap: 8px; margin-bottom: 4px;
                ">
                    <span style="
                        font-size: 0.62rem; font-weight: 700; letter-spacing: 1px;
                        color: ${accent}; opacity: 0.8; text-transform: uppercase;
                    ">Step ${i + 1}</span>
                    <span style="font-size: 0.88rem; font-weight: 600; color: #fff;">${step.title}</span>
                </div>
                <p style="font-size: 0.78rem; color: #888; line-height: 1.5; margin: 0;">${step.desc}</p>
            </div>
        </div>
    `).join('');

    const signOutBannerHTML = stepCfg.willSignOut ? `
        <div style="
            display: flex; gap: 10px; align-items: flex-start;
            padding: 12px 14px;
            background: rgba(255, 200, 0, 0.07);
            border: 1px solid rgba(255, 200, 0, 0.2);
            border-radius: 10px; margin-bottom: 16px;
        ">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f5c518" stroke-width="2.5" style="flex-shrink:0;margin-top:1px;">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <div>
                <div style="font-size: 0.78rem; font-weight: 700; color: #f5c518; margin-bottom: 3px;">Sign-out Warning</div>
                <div style="font-size: 0.75rem; color: #aaa; line-height: 1.5;">${stepCfg.signOutNote}</div>
            </div>
        </div>
    ` : '';

    // Riot special tray reminder (Clean & Modern)
    const riotTrayHTML = stepCfg.riotSpecial ? `
        <div style="
            display: flex; gap: 14px; align-items: flex-start;
            padding: 14px 16px;
            background: linear-gradient(90deg, color-mix(in srgb, ${accent} 12%, transparent) 0%, transparent 100%);
            border-left: 3px solid ${accent};
            border-radius: 4px 10px 10px 4px;
            margin-bottom: 18px;
        ">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${accent}" stroke-width="2.5" style="flex-shrink:0; margin-top:1px;">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <div>
                <div style="font-size: 0.82rem; font-weight: 700; color: #fff; margin-bottom: 5px; letter-spacing: 0.3px;">
                    Important Action Required
                </div>
                <div style="font-size: 0.76rem; color: #aaa; line-height: 1.6;">
                    After logging in, right-click the Riot tray icon and select 
                    <span style="color: #fff; background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.1); font-weight: 600; font-size: 0.7rem;">Quit</span>. 
                    The app must be fully closed before saving will work.
                </div>
            </div>
        </div>
    ` : '';
    

    // No-signout warning (Clean & Minimal)
    const noSignoutWarningHTML = `
        <div style="
            display: flex; gap: 10px; align-items: center;
            margin: 16px 4px 4px 4px;
        ">
            <div style="
                width: 3px; height: 16px; background: ${accent}; 
                border-radius: 3px; flex-shrink: 0; 
                box-shadow: 0 0 8px color-mix(in srgb, ${accent} 50%, transparent);
            "></div>
            <p style="font-size: 0.74rem; color: #888; line-height: 1.5; margin: 0;">
                ${stepCfg.warning}
            </p>
        </div>
    `;

    overlay.innerHTML = `
        <div style="
            background: #141414;
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 16px;
            width: 480px; max-width: calc(100vw - 40px);
            max-height: calc(100vh - 60px);
            overflow-y: auto;
            padding: 28px;
            box-shadow: 0 24px 60px rgba(0,0,0,0.6);
            animation: aamBoxIn 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
            font-family: var(--font-main, -apple-system, sans-serif);
            scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.1) transparent;
        ">
            <div style="display: flex; align-items: center; gap: 14px; margin-bottom: 22px;">
                <div style="
                    width: 44px; height: 44px; flex-shrink: 0;
                    display: flex; align-items: center; justify-content: center;
                    color: ${accent};
                ">${realLogoHTML}</div>
                <div>
                    <h2 style="margin: 0; font-size: 1.05rem; font-weight: 700; color: #fff; letter-spacing: -0.3px;">
                        Add ${cfg.name} Account
                    </h2>
                    <p style="margin: 3px 0 0; font-size: 0.75rem; color: #555;">
                        Follow the steps below — this will take about a minute.
                    </p>
                </div>
                <button id="aamCloseBtn" style="
                    margin-left: auto; width: 30px; height: 30px; border-radius: 8px;
                    background: transparent; border: 1px solid rgba(255,255,255,0.08);
                    color: #555; cursor: pointer; display: flex; align-items: center; justify-content: center;
                    transition: all 0.2s; flex-shrink: 0;
                " onmouseover="this.style.color='#fff';this.style.borderColor='rgba(255,255,255,0.2)'"
                   onmouseout="this.style.color='#555';this.style.borderColor='rgba(255,255,255,0.08)'">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                        <polygon points="11 1.576 6.583 6 11 10.424 10.424 11 6 6.583 1.576 11 1 10.424 5.417 6 1 1.576 1.576 1 6 5.417 10.424 1"/>
                    </svg>
                </button>
            </div>

            ${signOutBannerHTML}
            ${riotTrayHTML}

            <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px;">
                ${stepsHTML}
            </div>

            ${noSignoutWarningHTML}

            <label style="
                display: flex; align-items: center; gap: 10px;
                margin: 18px 0 20px; cursor: pointer;
            ">
                <input type="checkbox" id="aamDontAsk" style="
                    width: 16px; height: 16px; accent-color: ${accent};
                    cursor: pointer;
                ">
                <span style="font-size: 0.78rem; color: #555; user-select: none;">
                    Don't show this again for ${cfg.name}
                </span>
            </label>

            <div style="display: flex; gap: 10px;">
                <button id="aamCancelBtn" style="
                    flex: 1; padding: 11px; border-radius: 10px;
                    background: rgba(255,255,255,0.05);
                    border: 1px solid rgba(255,255,255,0.1);
                    color: #888; cursor: pointer; font-size: 0.85rem; font-weight: 600;
                    font-family: inherit; transition: all 0.2s;
                " onmouseover="this.style.background='rgba(255,255,255,0.09)';this.style.color='#fff'"
                   onmouseout="this.style.background='rgba(255,255,255,0.05)';this.style.color='#888'">
                    Cancel
                </button>
                <button id="aamConfirmBtn" class="aam-confirm-btn" style="
                    flex: 2; padding: 11px; border-radius: 10px;
                    background: ${accent}; color: ${btnTextColor};
                    border: none; cursor: pointer; font-size: 0.85rem; font-weight: 700;
                    font-family: inherit; transition: all 0.2s;
                    display: flex; align-items: center; justify-content: center; gap: 8px;
                " onmouseover="this.style.opacity='0.88';this.style.transform='translateY(-1px)'"
                   onmouseout="this.style.opacity='1';this.style.transform='none'">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                    </svg>
                    Got it, Let's Go!
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // ---- Event Listeners ----
    let confirmed = false;

    // 🟢 دعم الكيبورد (Enter للتأكيد و Escape للإلغاء)
    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault(); // نمنع أي أكشن افتراضي في الخلفية
            document.getElementById('aamConfirmBtn')?.click();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            closeModal();
        }
    };
    
    // تشغيل مراقب الكيبورد
    window.addEventListener('keydown', handleKeyDown);

    const closeModal = () => {
        // 🟢 إيقاف مراقب الكيبورد بمجرد قفل النافذة عشان ميعملش مشاكل بعدين
        window.removeEventListener('keydown', handleKeyDown);
        
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity 0.15s';
        setTimeout(() => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 150);
    };

    document.getElementById('aamCloseBtn').onclick  = closeModal;
    document.getElementById('aamCancelBtn').onclick = closeModal;

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
    });

    document.getElementById('aamConfirmBtn').onclick = () => {
        if (confirmed) return;
        confirmed = true;

        const dontAsk = document.getElementById('aamDontAsk');
        if (dontAsk && dontAsk.checked) {
            localStorage.setItem(dontAskKey, '1');
        }

        closeModal();
        onConfirm();
    };

    // 🟢 نقل الـ Focus لزرار التأكيد عشان الزرار اللي في الخلفية ميفضلش شغال
    setTimeout(() => {
        const confirmBtn = document.getElementById('aamConfirmBtn');
        if (confirmBtn) confirmBtn.focus();
    }, 10);
}

async function addNewAccount(platform) {
    if (isAccountProcessing) {
        showToast('Please wait for the current action to finish.', 'warning');
        return;
    }

    showAddAccountModal(platform, async () => {
        if (isAccountProcessing) return; 

        isAccountProcessing = true;

        const addBtns = document.querySelectorAll(`[onclick*="addNewAccount('${platform}')"]`);
        addBtns.forEach(btn => {
            btn._originalHTML = btn.innerHTML;
            btn.innerHTML = `<div class="acc-mini-spinner" style="border-top-color:#000;"></div> Opening...`;
            btn.disabled = true;
            btn.style.opacity = '0.7';
        });

        const cfg = PLATFORM_CONFIG[platform];
        showToast(`Opening ${cfg.name}...`, 'success');

        try {
            await cfg.addFn();
        } catch (err) {
            showToast(`Error: ${err}`, 'error');
        } finally {
            isAccountProcessing = false;
            addBtns.forEach(btn => {
                if (btn._originalHTML) btn.innerHTML = btn._originalHTML;
                btn.disabled = false;
                btn.style.opacity = '1';
            });
        }
    });
}