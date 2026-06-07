'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT    = path.resolve(__dirname, '..');
const MAIN_JS = fs.readFileSync(path.join(ROOT, 'main.js'),            'utf8');
const PRELOAD = fs.readFileSync(path.join(ROOT, 'preload.js'),         'utf8');
const HTML    = fs.readFileSync(path.join(ROOT, 'src/dashboard.html'), 'utf8');
const APP_JS  = fs.readFileSync(path.join(ROOT, 'src/js/app.js'),      'utf8');

// ─── 1. IPC handler — open-community-url ────────────────────────────────────

test('main.js: open-community-url handler is defined', () => {
    assert.match(MAIN_JS, /ipcMain\.handle\('open-community-url'/, 'handler must be registered');
});

test('main.js: open-community-url rejects non-https URLs', () => {
    const idx = MAIN_JS.indexOf("ipcMain.handle('open-community-url'");
    const block = MAIN_JS.slice(idx, idx + 800);
    assert.match(block, /protocol.*!==.*'https:'|'https:'.*!==.*protocol/s, 'must reject non-https protocol');
    assert.match(block, /PROTOCOL_NOT_ALLOWED/, 'must throw PROTOCOL_NOT_ALLOWED code');
});

test('main.js: open-community-url rejects unknown domains', () => {
    const idx = MAIN_JS.indexOf("ipcMain.handle('open-community-url'");
    const block = MAIN_JS.slice(idx, idx + 800);
    assert.match(block, /_COMMUNITY_ALLOWED_DOMAINS\.has\(host\)/, 'must check domain allowlist');
    assert.match(block, /DOMAIN_NOT_ALLOWED/, 'must throw DOMAIN_NOT_ALLOWED code');
});

test('main.js: _COMMUNITY_ALLOWED_DOMAINS contains all five platforms', () => {
    const idx = MAIN_JS.indexOf('_COMMUNITY_ALLOWED_DOMAINS');
    const block = MAIN_JS.slice(idx, idx + 500);
    assert.match(block, /discord\.gg/,     'must allow discord.gg');
    assert.match(block, /instagram\.com/,  'must allow instagram.com');
    assert.match(block, /x\.com/,          'must allow x.com');
    assert.match(block, /linkedin\.com/,   'must allow linkedin.com');
    assert.match(block, /tiktok\.com/,     'must allow tiktok.com');
});

test('main.js: open-community-url calls shell.openExternal on valid URL', () => {
    const idx = MAIN_JS.indexOf("ipcMain.handle('open-community-url'");
    const block = MAIN_JS.slice(idx, idx + 1200);
    assert.match(block, /shell\.openExternal\(url\)/, 'must call shell.openExternal');
});

test('main.js: open-community-url returns { status: success }', () => {
    const idx = MAIN_JS.indexOf("ipcMain.handle('open-community-url'");
    const block = MAIN_JS.slice(idx, idx + 1200);
    assert.match(block, /status:\s*'success'/, "must return { status: 'success' }");
});

// ─── 2. preload.js ───────────────────────────────────────────────────────────

test('preload.js: exposes openCommunityUrl', () => {
    assert.match(PRELOAD, /openCommunityUrl/, 'must expose openCommunityUrl');
    assert.match(PRELOAD, /open-community-url/, 'must invoke open-community-url channel');
});

// ─── 3. Sidebar — Community must NOT be in the sidebar ───────────────────────

test('dashboard.html: Community item is not rendered inside the sidebar', () => {
    const sidebarStart = HTML.indexOf('<aside class="sidebar"');
    const sidebarEnd   = HTML.indexOf('</aside>', sidebarStart);
    const sidebar      = HTML.slice(sidebarStart, sidebarEnd);
    assert.doesNotMatch(sidebar, /sidebar-community-btn/, 'sidebar-community-btn must be removed');
    assert.doesNotMatch(sidebar, /openCommunityModal/, 'sidebar must not call openCommunityModal');
});

test('dashboard.html: Context action button is still in the sidebar', () => {
    const sidebarStart = HTML.indexOf('<aside class="sidebar"');
    const sidebarEnd   = HTML.indexOf('</aside>', sidebarStart);
    const sidebar      = HTML.slice(sidebarStart, sidebarEnd);
    assert.match(sidebar, /add-coll-btn/, 'Context action button must still exist in sidebar');
    // handleSidebarContextBtn is now the single owner of the button click logic
    assert.match(sidebar, /handleSidebarContextBtn/, 'Context button must call handleSidebarContextBtn');
});

// ─── 4. Help & Feedback dropdown ────────────────────────────────────────────

test('dashboard.html: Help dropdown wrapper exists in title-bar', () => {
    const titleBarEnd = HTML.indexOf('</div>', HTML.indexOf('class="title-bar"')) + 1000;
    const titleBar    = HTML.slice(HTML.indexOf('class="title-bar"'), titleBarEnd);
    assert.match(titleBar, /helpDropdownWrap/, 'helpDropdownWrap must be in the title-bar area');
});

test('dashboard.html: Help dropdown menu contains Community & Socials entry', () => {
    const idx  = HTML.indexOf('helpDropdownMenu');
    const block = HTML.slice(idx, idx + 2000);
    assert.match(block, /Community &amp; Socials/, 'dropdown must contain Community & Socials');
});

test('dashboard.html: Community & Socials item calls handleHelpDropdownAction(event, community)', () => {
    const idx  = HTML.indexOf('helpDropdownMenu');
    const block = HTML.slice(idx, idx + 2000);
    assert.match(block, /handleHelpDropdownAction\(event,'community'\)/, 'Community item must use handleHelpDropdownAction');
});

test('dashboard.html: Help dropdown has Report a Bug entry using handleHelpDropdownAction', () => {
    const idx  = HTML.indexOf('helpDropdownMenu');
    const block = HTML.slice(idx, idx + 2000);
    assert.match(block, /Report a Bug/, 'dropdown must contain Report a Bug');
    assert.match(block, /handleHelpDropdownAction\(event,'bug'\)/, 'Report a Bug must use handleHelpDropdownAction');
});

test('dashboard.html: Help dropdown items have type=button', () => {
    const idx  = HTML.indexOf('helpDropdownMenu');
    const block = HTML.slice(idx, idx + 2000);
    const typeButtonCount = (block.match(/type="button"/g) || []).length;
    assert.ok(typeButtonCount >= 3, 'all three dropdown items must have type="button"');
});

test('dashboard.html: Help dropdown trigger calls toggleHelpDropdown', () => {
    const wrapIdx = HTML.indexOf('helpDropdownWrap');
    const block   = HTML.slice(wrapIdx, wrapIdx + 300);
    assert.match(block, /toggleHelpDropdown/, 'trigger button must call toggleHelpDropdown');
});

// ─── 5. dashboard.html — Community modal content ─────────────────────────────

test('dashboard.html: communityModal exists', () => {
    assert.match(HTML, /id="communityModal"/, 'communityModal element must exist');
});

test('dashboard.html: community modal title is correct', () => {
    assert.match(HTML, /Join the Baddel Community/, 'modal title must be correct');
});

test('dashboard.html: community modal subtitle is correct', () => {
    assert.match(HTML, /Get the latest updates, release news, support/, 'subtitle must be correct');
});

test('dashboard.html: community modal contains Discord link', () => {
    assert.match(HTML, /https:\/\/discord\.gg\/h4F9xbGJHg/, 'must contain Discord URL');
    assert.match(HTML, /Join Discord/, 'must have Join Discord button text');
});

test('dashboard.html: community modal contains Instagram link', () => {
    assert.match(HTML, /https:\/\/www\.instagram\.com\/baddel\.official\//, 'must contain Instagram URL');
    assert.match(HTML, /Follow on Instagram/, 'must have Follow on Instagram button text');
});

test('dashboard.html: community modal contains X link', () => {
    assert.match(HTML, /https:\/\/x\.com\/BaddelOfficial/, 'must contain X URL');
    assert.match(HTML, /Follow on X/, 'must have Follow on X button text');
});

test('dashboard.html: community modal contains LinkedIn link', () => {
    assert.match(HTML, /https:\/\/www\.linkedin\.com\/company\/baddel-marketplace\//, 'must contain LinkedIn URL');
    assert.match(HTML, /Follow on LinkedIn/, 'must have Follow on LinkedIn button text');
});

test('dashboard.html: community modal contains TikTok link', () => {
    assert.match(HTML, /https:\/\/www\.tiktok\.com\/@baddel_official_/, 'must contain TikTok URL');
    assert.match(HTML, /Follow on TikTok/, 'must have Follow on TikTok button text');
});

test('dashboard.html: community cards call openCommunityLink with correct URLs', () => {
    assert.match(HTML, /openCommunityLink\('https:\/\/discord\.gg\/h4F9xbGJHg'\)/, 'Discord card must call openCommunityLink');
    assert.match(HTML, /openCommunityLink\('https:\/\/x\.com\/BaddelOfficial'\)/, 'X card must call openCommunityLink');
    assert.match(HTML, /openCommunityLink\('https:\/\/www\.instagram\.com\/baddel\.official\/'\)/, 'Instagram card must call openCommunityLink');
    assert.match(HTML, /openCommunityLink\('https:\/\/www\.linkedin\.com\/company\/baddel-marketplace\/'\)/, 'LinkedIn card must call openCommunityLink');
    assert.match(HTML, /openCommunityLink\('https:\/\/www\.tiktok\.com\/@baddel_official_'\)/, 'TikTok card must call openCommunityLink');
});

// ─── 6. app.js ───────────────────────────────────────────────────────────────

test('app.js: openHelpModal accepts optional tab parameter', () => {
    const fnStart = APP_JS.indexOf('function openHelpModal(');
    const fn = APP_JS.slice(fnStart, fnStart + 200);
    assert.match(fn, /function openHelpModal\(tab\)/, 'openHelpModal must accept tab parameter');
    assert.match(fn, /if \(tab\)/, 'must conditionally switch tab');
});

test('app.js: toggleHelpDropdown is defined with e.preventDefault and stopPropagation', () => {
    assert.match(APP_JS, /function toggleHelpDropdown\(e\)/, 'toggleHelpDropdown must be defined');
    const fnStart = APP_JS.indexOf('function toggleHelpDropdown(e)');
    const fn = APP_JS.slice(fnStart, fnStart + 350);
    assert.match(fn, /helpDropdownMenu/, 'must reference helpDropdownMenu');
    assert.match(fn, /classList\.toggle\('active'/, 'must toggle active class');
    assert.match(fn, /e\.preventDefault\(\)/, 'must call e.preventDefault');
    assert.match(fn, /e\.stopPropagation\(\)/, 'must call e.stopPropagation');
});

test('app.js: closeHelpDropdown is defined', () => {
    assert.match(APP_JS, /function closeHelpDropdown\(\)/, 'closeHelpDropdown must be defined');
    const fnStart = APP_JS.indexOf('function closeHelpDropdown()');
    const fn = APP_JS.slice(fnStart, fnStart + 150);
    assert.match(fn, /classList\.remove\('active'\)/, 'must remove active class');
});

test('app.js: openCommunityModal is defined', () => {
    assert.match(APP_JS, /function openCommunityModal\(\)/, 'openCommunityModal must be defined');
    const fnStart = APP_JS.indexOf('function openCommunityModal()');
    const fn = APP_JS.slice(fnStart, fnStart + 200);
    assert.match(fn, /communityModal/, 'must reference communityModal element');
    assert.match(fn, /classList\.add\('active'\)/, 'must add active class');
});

test('app.js: closeCommunityModal is defined', () => {
    assert.match(APP_JS, /function closeCommunityModal\(\)/, 'closeCommunityModal must be defined');
    const fnStart = APP_JS.indexOf('function closeCommunityModal()');
    const fn = APP_JS.slice(fnStart, fnStart + 200);
    assert.match(fn, /classList\.remove\('active'\)/, 'must remove active class');
});

test('app.js: openCommunityLink calls openCommunityUrl', () => {
    assert.match(APP_JS, /async function openCommunityLink\(url\)/, 'openCommunityLink must be defined');
    const fnStart = APP_JS.indexOf('async function openCommunityLink(url)');
    const fn = APP_JS.slice(fnStart, fnStart + 300);
    assert.match(fn, /openCommunityUrl\(url\)/, 'must call openCommunityUrl with the url');
});

test('app.js: handleHelpDropdownAction is defined', () => {
    assert.match(APP_JS, /function handleHelpDropdownAction\(e, action\)/, 'handleHelpDropdownAction must be defined');
});

test('app.js: handleHelpDropdownAction calls preventDefault and stopPropagation', () => {
    const fnStart = APP_JS.indexOf('function handleHelpDropdownAction(e, action)');
    const fn = APP_JS.slice(fnStart, fnStart + 500);
    assert.match(fn, /e\.preventDefault\(\)/, 'must call e.preventDefault');
    assert.match(fn, /e\.stopPropagation\(\)/, 'must call e.stopPropagation');
    assert.match(fn, /stopImmediatePropagation/, 'must call stopImmediatePropagation');
});

test('app.js: handleHelpDropdownAction routes all three actions correctly', () => {
    const fnStart = APP_JS.indexOf('function handleHelpDropdownAction(e, action)');
    const fn = APP_JS.slice(fnStart, fnStart + 500);
    assert.match(fn, /openHelpModal\('guide'\)/, 'must call openHelpModal(guide) for help action');
    assert.match(fn, /openHelpModal\('feedback'\)/, 'must call openHelpModal(feedback) for bug action');
    assert.match(fn, /openCommunityModal\(\)/, 'must call openCommunityModal() for community action');
    assert.match(fn, /closeHelpDropdown\(\)/, 'must close dropdown before routing');
});

test('app.js: handleHelpDropdownAction is exposed on window', () => {
    assert.match(APP_JS, /window\.handleHelpDropdownAction\s*=\s*handleHelpDropdownAction/, 'must be on window');
});

// ─── 7. CSS — no-drag and pointer-events ─────────────────────────────────────

const CSS_JS = fs.readFileSync(path.join(ROOT, 'src/css/dashboard.css'), 'utf8');

test('dashboard.css: .help-dropdown-wrap has no-drag and pointer-events auto', () => {
    assert.match(CSS_JS, /-webkit-app-region:\s*no-drag/, 'must include -webkit-app-region: no-drag');
    const wrapIdx = CSS_JS.indexOf('.help-dropdown-wrap');
    const block   = CSS_JS.slice(wrapIdx, wrapIdx + 300);
    assert.match(block, /pointer-events:\s*auto/, 'wrap must have pointer-events: auto');
});

test('dashboard.css: .help-dropdown-menu has no-drag, pointer-events, and high z-index', () => {
    const menuIdx = CSS_JS.indexOf('.help-dropdown-menu {');
    const block   = CSS_JS.slice(menuIdx, menuIdx + 400);
    assert.match(block, /-webkit-app-region:\s*no-drag/, 'menu must have no-drag');
    assert.match(block, /pointer-events:\s*auto/, 'menu must have pointer-events: auto');
    const zMatch = block.match(/z-index:\s*(\d+)/);
    assert.ok(zMatch, 'menu must have a z-index');
    assert.ok(parseInt(zMatch[1]) >= 100000, 'z-index must be at least 100000');
});

test('dashboard.css: .help-dropdown-item has no-drag and pointer-events', () => {
    const itemIdx = CSS_JS.indexOf('.help-dropdown-item {');
    const block   = CSS_JS.slice(itemIdx, itemIdx + 400);
    assert.match(block, /-webkit-app-region:\s*no-drag/, 'item must have no-drag');
    assert.match(block, /pointer-events:\s*auto/, 'item must have pointer-events: auto');
});

test('dashboard.css: .title-bar has overflow: visible', () => {
    const tbIdx = CSS_JS.indexOf('.title-bar {');
    const block  = CSS_JS.slice(tbIdx, tbIdx + 350);
    assert.match(block, /overflow:\s*visible/, 'title-bar must have overflow: visible');
});

// ─── 8. Community card layout ────────────────────────────────────────────────

test('dashboard.css: community grid uses 2-column layout with stretch alignment', () => {
    const idx   = CSS_JS.indexOf('.community-cards-grid {');
    const block = CSS_JS.slice(idx, idx + 200);
    assert.match(block, /grid-template-columns:\s*repeat\(2/, 'must use 2-column grid');
    assert.match(block, /align-items:\s*stretch/, 'must stretch items to equal height');
});

test('dashboard.css: community card uses flex-column with space-between and min-height', () => {
    const idx   = CSS_JS.indexOf('.community-card {');
    const block = CSS_JS.slice(idx, idx + 300);
    assert.match(block, /display:\s*flex/, 'card must use flex');
    assert.match(block, /flex-direction:\s*column/, 'card must be a column');
    assert.match(block, /justify-content:\s*space-between/, 'card must use space-between');
    assert.match(block, /min-height:\s*140px/, 'card must have min-height of 140px');
});

test('dashboard.css: community card button has margin-top: auto', () => {
    const idx   = CSS_JS.indexOf('.community-card-btn {');
    const block = CSS_JS.slice(idx, idx + 450);
    assert.match(block, /margin-top:\s*auto/, 'button must have margin-top: auto to pin to bottom');
});

test('dashboard.css: last odd community card spans full grid width', () => {
    assert.match(CSS_JS, /\.community-card:last-child:nth-child\(odd\)/, 'must have odd last-child rule');
    const idx   = CSS_JS.indexOf('.community-card:last-child:nth-child(odd)');
    const block = CSS_JS.slice(idx, idx + 100);
    assert.match(block, /grid-column:\s*1\s*\/\s*-1/, 'last odd card must span full width');
});

test('dashboard.css: mobile media query resets community grid to 1 column', () => {
    // Find the @media block that contains community-cards-grid with a 1fr reset
    const communityGridIdx = CSS_JS.lastIndexOf('community-cards-grid');
    assert.ok(communityGridIdx !== -1, 'community-cards-grid must exist in a media query');
    const mqStart = CSS_JS.lastIndexOf('@media', communityGridIdx);
    const blk = CSS_JS.slice(mqStart, mqStart + 300);
    assert.match(blk, /community-cards-grid/, 'breakpoint must target community-cards-grid');
    assert.match(blk, /grid-template-columns:\s*1fr/, 'mobile must use single column');
});
