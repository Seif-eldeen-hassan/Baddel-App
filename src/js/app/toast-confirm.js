// ── Toast notifications and confirm modal ────────────────────────────────────
// Loads before launcher-actions.js, app.js, and account modules so that
// showToast and the confirm helpers are available in the shared Global
// Declarative Environment Record when those files call them.
// Depends on escapeHtml from domUtils.js (loaded earlier in dashboard.html).

function showToast(msgOrOpts, t) {
    let message, type, duration = 3500;
    if (typeof msgOrOpts === 'object' && msgOrOpts !== null) {
        message = msgOrOpts.message || msgOrOpts.title || '';
        type = msgOrOpts.type || t;
        duration = msgOrOpts.duration || 3500;
    } else {
        message = msgOrOpts;
        type = t;
    }
    const w = document.getElementById('toast-wrapper');
    const d = document.createElement('div');
    d.className = `toast-notification ${type === 'error' ? 'toast-error' : ''}`;
    d.innerHTML = `<span>${message}</span>`;
    w.appendChild(d);
    setTimeout(() => { d.style.animation = 'fadeOutUp 0.3s ease forwards'; setTimeout(() => d.remove(), 300); }, duration);
}

let pendingConfirmAction = null;

function openConfirmModal(title, message, buttonText, callback) {
    document.getElementById('confirmTitle').innerHTML = `&#9888; ${escapeHtml(title)}`;
    document.getElementById('confirmMessage').innerText = message;
    document.getElementById('confirmBtn').innerText = buttonText;
    pendingConfirmAction = callback;
    document.getElementById('confirmModal').classList.add('active');
}

function closeConfirmModal() {
    document.getElementById('confirmModal').classList.remove('active');
    pendingConfirmAction = null;
}

async function executeConfirm() {
    if (pendingConfirmAction) {
        const btn = document.getElementById('confirmBtn');
        const originalText = btn.innerText;
        btn.innerText = 'Processing...';
        btn.disabled = true;
        btn.style.opacity = '0.7';
        await pendingConfirmAction();
        btn.innerText = originalText;
        btn.disabled = false;
        btn.style.opacity = '1';
    }
    closeConfirmModal();
}

// Explicit window exports so inline onclick handlers and cross-file calls resolve correctly
window.showToast        = showToast;
window.openConfirmModal = openConfirmModal;
window.closeConfirmModal = closeConfirmModal;
window.executeConfirm   = executeConfirm;
