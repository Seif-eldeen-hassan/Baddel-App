'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/js/accounts.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'src/dashboard.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/css/dashboard.css'), 'utf8');

test('Back to top is an accessible inline-SVG control on the real main scroller', () => {
    assert.match(html, /id="agBackToTop"[^>]*aria-label="Back to top"[^>]*title="Back to top"[^>]*hidden/);
    assert.match(html, /id="agBackToTop"[\s\S]{0,300}<svg/);
    assert.match(html, /<\/main>\s*<\/div>\s*<button[^>]*id="agBackToTop"/, 'fixed control must stay outside hidden route views');
    assert.match(source, /getElementById\('mainContentArea'\)/);
    assert.doesNotMatch(source.slice(source.indexOf('const AG_BACK_TO_TOP_THRESHOLD'), source.indexOf('async function _syncEpicAndRefresh')), /window\.scrollTo|scrollIntoView/);
});

test('visibility is route-scoped, thresholded, and independent of Grid/List mode', () => {
    const start = source.indexOf('const AG_BACK_TO_TOP_THRESHOLD');
    const block = source.slice(start, source.indexOf('async function _syncEpicAndRefresh', start));
    assert.match(block, /AG_BACK_TO_TOP_THRESHOLD = 500/);
    assert.match(block, /currentView === 'all-games'/);
    assert.match(block, /allGamesView\?\.style\.display !== 'none'/);
    assert.match(block, /scroller\.scrollTop < AG_BACK_TO_TOP_THRESHOLD/);
    assert.doesNotMatch(block, /_agDisplayPrefs|viewMode\s*===\s*['"](?:grid|list)/i);
});

test('one passive listener is idempotently bound and click performs an instant state-preserving jump', () => {
    const start = source.indexOf('window._agInitBackToTop');
    const block = source.slice(start, source.indexOf('async function _syncEpicAndRefresh', start));
    assert.match(block, /button\.dataset\.bound === '1'/);
    assert.match(block, /addEventListener\('scroll', window\._agSyncBackToTopVisibility, \{ passive: true \}\)/);
    assert.match(block, /scroller\.scrollTop = 0/);
    assert.doesNotMatch(block, /_vsInit|_applyAgFilters|navigateToAllGames|agReadyOnly\s*=|scrollBehavior/);
    assert.equal((source.match(/const AG_BACK_TO_TOP_THRESHOLD/g) || []).length, 1);
});

test('hidden control cannot intercept input and visible styling is compact/fixed', () => {
    assert.match(css, /\.ag-back-to-top\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?width:\s*42px;[\s\S]*?height:\s*42px;/);
    assert.match(css, /\.ag-back-to-top\[hidden\]\s*\{[\s\S]*?display:\s*none;[\s\S]*?pointer-events:\s*none;/);
    assert.match(css, /\.ag-back-to-top\s*\{[\s\S]*?border-radius:\s*999px;[\s\S]*?rgba\(18,206,24,0\.38\)[\s\S]*?rgba\(14,16,15,0\.9\)/);
    assert.match(css, /\.ag-back-to-top svg\s*\{[\s\S]*?width:\s*16px;[\s\S]*?height:\s*16px;[\s\S]*?stroke-width:\s*2\.4/);
    assert.doesNotMatch(css.slice(css.indexOf('.ag-back-to-top'), css.indexOf('.library-section')), /gradient|b88cff|border-radius:\s*14px/);
});
