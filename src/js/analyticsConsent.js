'use strict';

async function initAnalyticsConsent() {
    try {
        const alreadyShown = await window.electronAPI.getConsentShown();
        if (alreadyShown) return;
    } catch(e) {
        console.warn('[Analytics] Could not read consent state:', e);
        return;
    }

    await new Promise(r => setTimeout(r, 100));

    const overlay = document.getElementById('analyticsConsentOverlay');
    if (overlay) {
        overlay.style.zIndex = '9999999';
        overlay.style.display = 'flex';
    }
}

function closeAndSaveConsent() {
    window.electronAPI.setConsentShown().catch(e => console.warn('[Analytics] Could not save consent state:', e));

    const overlay = document.getElementById('analyticsConsentOverlay');
    if (overlay) {
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity 0.2s';
        setTimeout(() => overlay.style.display = 'none', 200);
    }
}

async function handleConsentAccept() {
    closeAndSaveConsent();
    try {
        if (window.electronAPI && window.electronAPI.grantAnalyticsConsent) {
            await window.electronAPI.grantAnalyticsConsent();
            console.log('[Analytics] Consent granted.');
        }
    } catch(e) {
        console.warn('[Analytics] Error:', e);
    }
}

async function handleConsentDecline() {
    closeAndSaveConsent();
    try {
        if (window.electronAPI && window.electronAPI.revokeAnalyticsConsent) {
            await window.electronAPI.revokeAnalyticsConsent();
        }
        console.log('[Analytics] Consent declined.');
    } catch(e) {
        console.warn('[Analytics] Error:', e);
    }
}

// initAnalyticsConsent is called from app.js after the loader finishes
