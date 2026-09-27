'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
test('same-game hydration preserves standard INSTALL; switching to installed game shows PLAY without split controls', () => {
    const source = fs.readFileSync('src/js/game-details.js', 'utf8');
    const classes = new Set();
    const cls = { add: v => classes.add(v), remove: v => classes.delete(v) };
    const icon = { style: {} };
    const elements = { gdPlayBtn: { classList: cls, querySelector: () => icon }, gdPlayBtnLabel: {} };
    const context = { document: { getElementById: id => elements[id] || null }, _gdFindInstalledLocalMatch: () => null, _gdInstalledRecordCanLaunch: g => !!g?.isInstalled };
    context.window = context; vm.createContext(context);
    vm.runInContext(source.slice(source.indexOf('function _gdSetActionButton(game)'), source.indexOf('window.gdHandleMainAction = async function()')), context);
    for (const game of [{ id: 'a', platform: 'epic' }, { id: 'a', platform: 'epic' }, { id: 'b', platform: 'steam' }]) {
        context._gdSetActionButton(game); assert.equal(elements.gdPlayBtnLabel.textContent, 'INSTALL'); assert.equal(classes.has('install-mode'), true);
    }
    context._gdSetActionButton({ id: 'b', isInstalled: true });
    assert.equal(elements.gdPlayBtnLabel.textContent, 'PLAY'); assert.equal(classes.has('install-mode'), false); assert.equal(icon.style.display, 'inline-block');
});
