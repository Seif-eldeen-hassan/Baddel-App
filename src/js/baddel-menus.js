(function () {
    'use strict';
    let open = null;
    const VIEWPORT_MARGIN = 8;

    function positionPortal(entry) {
        if (!entry?.portal || !entry.trigger?.isConnected || !entry.menu?.isConnected) return;
        const triggerRect = entry.trigger.getBoundingClientRect();
        const menu = entry.menu;
        menu.style.position = 'fixed';
        menu.style.right = 'auto';
        menu.style.bottom = 'auto';
        menu.style.maxHeight = `${Math.max(80, window.innerHeight - VIEWPORT_MARGIN * 2)}px`;
        menu.style.maxWidth = `${Math.max(80, window.innerWidth - VIEWPORT_MARGIN * 2)}px`;
        menu.style.overflowY = 'auto';
        const menuRect = menu.getBoundingClientRect();
        const width = menuRect.width;
        const height = menuRect.height;
        const roomBelow = window.innerHeight - triggerRect.bottom - VIEWPORT_MARGIN;
        const roomAbove = triggerRect.top - VIEWPORT_MARGIN;
        const left = Math.min(
            Math.max(VIEWPORT_MARGIN, triggerRect.right - width),
            Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN)
        );
        const preferredTop = roomBelow >= height || roomBelow >= roomAbove
            ? triggerRect.bottom + VIEWPORT_MARGIN
            : triggerRect.top - height - VIEWPORT_MARGIN;
        const top = Math.min(
            Math.max(VIEWPORT_MARGIN, preferredTop),
            Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN)
        );
        menu.style.left = `${Math.round(left)}px`;
        menu.style.top = `${Math.round(top)}px`;
    }

    function close(restoreFocus = false) {
        if (!open) return;
        const { root, trigger, menu, portal } = open;
        if (menu) { menu.hidden = true; menu.classList.remove('active'); }
        trigger?.setAttribute('aria-expanded', 'false');
        if (portal && root?.isConnected && menu) {
            menu.classList.remove('baddel-menu-portal');
            menu.removeAttribute('style');
            root.appendChild(menu);
        }
        open = null;
        if (restoreFocus && trigger?.isConnected) trigger.focus();
    }
    function items(root) { return [...root.querySelectorAll('[role^="menuitem"]:not(:disabled)')]; }
    function toggle(root, focus = false) {
        if (open?.root === root) return close();
        close();
        const menu = root.querySelector('[role="menu"]');
        if (!menu) return;
        const trigger = root.querySelector('[data-menu-trigger]');
        const portal = root.hasAttribute('data-menu-portal');
        open = { root, menu, trigger, portal };
        if (portal) {
            menu.classList.add('baddel-menu-portal');
            document.body.appendChild(menu);
        }
        menu.hidden = false;
        menu.classList.add('active');
        trigger.setAttribute('aria-expanded', 'true');
        if (portal) positionPortal(open);
        if (focus) items(menu)[0]?.focus();
    }
    document.addEventListener('click', event => {
        const trigger = event.target.closest('[data-menu-trigger]');
        if (trigger) return toggle(trigger.closest('[data-baddel-menu]'));
        if (open && ((!open.root.contains(event.target) && !open.menu.contains(event.target)) || event.target.closest('[role^="menuitem"]'))) close();
    });
    document.addEventListener('keydown', event => {
        const trigger = event.target.closest('[data-menu-trigger]');
        if (trigger && ['Enter', ' ', 'ArrowDown'].includes(event.key)) {
            event.preventDefault();
            toggle(trigger.closest('[data-baddel-menu]'), true);
        } else if (open && event.key === 'Escape') {
            event.preventDefault(); close(true);
        } else if (open && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && (open.root.contains(event.target) || open.menu.contains(event.target))) {
            event.preventDefault();
            const options = items(open.menu);
            const current = options.indexOf(document.activeElement);
            const index = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
            options[index]?.focus();
        }
    });
    document.addEventListener('focusin', event => { if (open && !open.root.contains(event.target) && !open.menu.contains(event.target)) close(); });
    window.addEventListener('resize', () => positionPortal(open));
    document.addEventListener('scroll', () => positionPortal(open), true);
    window.baddelMenus = { close };
})();
