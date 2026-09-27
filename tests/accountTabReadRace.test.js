'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('src/js/accounts/platform-panels.js', 'utf8');
function setup() {
    let grid = { innerHTML: '', appendChild() {} }, resolve;
    const counts = [];
    const context = vm.createContext({
        currentAccountPlatform: 'gog',
        window: { electronAPI: { getGogProfiles: () => new Promise(r => { resolve = r; }) } },
        document: { getElementById: id => id === 'accountsGrid' ? grid : null },
        setPlatformAccountCount: (...args) => counts.push(args), console,
        _renderGogPendingAddState: async () => {},
        PLATFORM_CONFIG: { gog: { name: 'GOG', accent: '#123456' } }, escapeHtml: String,
    });
    const start = source.indexOf('const _accountProfileReads =');
    const end = source.indexOf('async function _renderGogPendingAddState', start);
    vm.runInContext(source.slice(start, end), context);
    return { context, counts, resolve: x => resolve(x), replace: () => { grid = { innerHTML: '', appendChild() {} }; } };
}
test('old GOG result cannot update counts after switching to Steam', async () => {
    const f = setup(); const pending = f.context.loadAccountsForPlatform('gog');
    await Promise.resolve(); f.context.currentAccountPlatform = 'steam'; f.resolve([]); await pending;
    assert.equal(f.counts.length, 0);
});
test('GOG to Steam to GOG does not accept a result for an old grid', async () => {
    const f = setup(); const pending = f.context.loadAccountsForPlatform('gog');
    await Promise.resolve(); f.replace(); f.resolve([]); await pending;
    assert.equal(f.counts.length, 0);
});
test('in-flight read requests are shared but completed results are not permanently cached', async () => {
    const f = setup(); let reads = 0, release;
    const read = () => { reads++; return new Promise(r => { release = r; }); };
    const a = f.context._readAccountProfilesOnce('epic', read);
    const b = f.context._readAccountProfilesOnce('epic', read);
    assert.equal(a, b); await Promise.resolve(); assert.equal(reads, 1);
    release([]); await a;
    await f.context._readAccountProfilesOnce('epic', () => { reads++; return []; });
    assert.equal(reads, 2);
});
