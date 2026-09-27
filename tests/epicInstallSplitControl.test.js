'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
test('all platforms use the existing normal INSTALL design, method controls live in the modal', () => {
    const html = fs.readFileSync('src/dashboard.html', 'utf8');
    const js = fs.readFileSync('src/js/game-details.js', 'utf8');
    assert.doesNotMatch(html, /epic-install-split|gdInstallMethodToggle/);
    assert.match(html, /class="gd-play-btn" id="gdPlayBtn"/);
    assert.match(js, /label.textContent = 'INSTALL'/);
    assert.match(js, /id="gdInstallMethodsSection" hidden/);
});
test('shared custom menu keyboard/outside close maintains aria and focus', () => {
    const listeners = {}; let focusCount = 0;
    const trigger = { setAttribute: (key, value) => trigger[key] = value, focus: () => focusCount++, isConnected: true, closest: () => root };
    const menu = { hidden: true, classList: { add() {}, remove() {} } };
    const item = { focus: () => focusCount++ };
    const root = { querySelector: selector => selector.includes('trigger') ? trigger : menu, querySelectorAll: () => [item], contains: target => target === trigger || target === item };
    const document = { addEventListener: (name, fn) => listeners[name] = fn, activeElement: trigger };
    const context = { document }; context.window = context;
    vm.runInNewContext(fs.readFileSync('src/js/baddel-menus.js', 'utf8'), context);
    const target = { closest: () => trigger };
    listeners.keydown({ target, key: 'Enter', preventDefault() {} }); assert.equal(menu.hidden, false); assert.equal(trigger['aria-expanded'], 'true');
    listeners.keydown({ target: { closest: () => null }, key: 'Escape', preventDefault() {} }); assert.equal(menu.hidden, true); assert.equal(trigger['aria-expanded'], 'false');
    listeners.keydown({ target, key: ' ', preventDefault() {} }); assert.equal(menu.hidden, false);
    listeners.click({ target: { closest: () => null } }); assert.equal(menu.hidden, true); assert.ok(focusCount >= 3);
});
