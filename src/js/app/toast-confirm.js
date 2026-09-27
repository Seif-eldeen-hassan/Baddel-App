// ── Toast notifications and confirm modal ────────────────────────────────────
// Loads before launcher-actions.js, app.js, and account modules so that
// showToast and the confirm helpers are available in the shared Global
// Declarative Environment Record when those files call them.
// Depends on escapeHtml from domUtils.js (loaded earlier in dashboard.html).

const activeToastsById = new Map();

function showToast(msgOrOpts, t) {
    let message, type, duration = 3500;
    let toastId = '';
    if (typeof msgOrOpts === 'object' && msgOrOpts !== null) {
        message = msgOrOpts.message || msgOrOpts.title || '';
        type = msgOrOpts.type || t;
        duration = msgOrOpts.duration || 3500;
        toastId = String(msgOrOpts.id || '');
    } else {
        message = msgOrOpts;
        type = t;
    }
    const w = document.getElementById('toast-wrapper');
    const previous = toastId ? activeToastsById.get(toastId) : null;
    if (previous?.timer) clearTimeout(previous.timer);
    const d = previous?.element?.isConnected ? previous.element : document.createElement('div');
    d.className = `toast-notification ${type === 'error' ? 'toast-error' : ''}`;
    d.style.animation = '';
    d.replaceChildren();
    const text = document.createElement('span');
    text.textContent = message;
    d.appendChild(text);
    if (!d.isConnected) w.appendChild(d);
    const timer = setTimeout(() => {
        d.style.animation = 'fadeOutUp 0.3s ease forwards';
        setTimeout(() => {
            d.remove();
            if (toastId && activeToastsById.get(toastId)?.element === d) activeToastsById.delete(toastId);
        }, 300);
    }, duration);
    if (toastId) activeToastsById.set(toastId, { element: d, timer });
    return d;
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
