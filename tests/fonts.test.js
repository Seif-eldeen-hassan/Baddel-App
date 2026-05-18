'use strict';

const test   = require('node:test');
const assert = require('node:assert/strict');
const fs     = require('node:fs');
const path   = require('node:path');

const ROOT     = path.resolve(__dirname, '..');
const CSS_DIR  = path.join(ROOT, 'src', 'css');
const FONT_DIR = path.join(ROOT, 'assets', 'fonts');

// ── Font files exist in assets/fonts ─────────────────────────────────────────

const REQUIRED_FONTS = [
    'Montserrat-VariableFont_wght.ttf',
    'Montserrat-Italic-VariableFont_wght.ttf',
    'Outfit-VariableFont_wght.ttf',
    'JetBrainsMono-VariableFont_wght.ttf',
    'JetBrainsMono-Italic-VariableFont_wght.ttf',
    'Fontspring-DEMO-lufga-regular.otf',
    'Fontspring-DEMO-lufga-extrabold.otf',
    'Tajawal-Regular.ttf',
    'Lato-Regular.ttf',
];

for (const file of REQUIRED_FONTS) {
    test(`font file: ${file} exists in assets/fonts`, () => {
        assert.ok(
            fs.existsSync(path.join(FONT_DIR, file)),
            `assets/fonts/${file} not found`
        );
    });
}

// ── fonts.css: single source of truth for @font-face + CSS vars ──────────────

const fontsCss = fs.readFileSync(path.join(CSS_DIR, 'fonts.css'), 'utf8');

test('fonts.css: exists', () => {
    assert.ok(fs.existsSync(path.join(CSS_DIR, 'fonts.css')), 'src/css/fonts.css must exist');
});

test('fonts.css: defines @font-face for Lufga (brand/display)', () => {
    assert.match(fontsCss, /@font-face[\s\S]*?Lufga/, 'fonts.css must declare @font-face for Lufga');
});

test('fonts.css: defines @font-face for Montserrat (main UI font)', () => {
    assert.match(fontsCss, /@font-face[\s\S]*?Montserrat/, 'fonts.css must declare @font-face for Montserrat');
});

test('fonts.css: defines @font-face for Outfit (secondary heading font)', () => {
    assert.match(fontsCss, /@font-face[\s\S]*?Outfit/, 'fonts.css must declare @font-face for Outfit');
});

test('fonts.css: defines @font-face for JetBrains Mono (technical/code text)', () => {
    assert.match(fontsCss, /@font-face[\s\S]*?JetBrains Mono/, 'fonts.css must declare @font-face for JetBrains Mono');
});

test('fonts.css: defines @font-face for Tajawal (Arabic text)', () => {
    assert.match(fontsCss, /@font-face[\s\S]*?Tajawal/, 'fonts.css must declare @font-face for Tajawal');
});

test('fonts.css: defines @font-face for Lato (Steam/login areas)', () => {
    assert.match(fontsCss, /@font-face[\s\S]*?Lato/, 'fonts.css must declare @font-face for Lato');
});

test('fonts.css: --font-brand uses Lufga as first family', () => {
    const m = fontsCss.match(/--font-brand\s*:[^;]+;/);
    assert.ok(m, '--font-brand variable missing from fonts.css');
    assert.ok(m[0].includes('Lufga'), '--font-brand must lead with Lufga');
});

test('fonts.css: --font-main uses Montserrat as first family', () => {
    const m = fontsCss.match(/--font-main\s*:[^;]+;/);
    assert.ok(m, '--font-main variable missing from fonts.css');
    assert.ok(m[0].includes('Montserrat'), '--font-main must lead with Montserrat');
});

test('fonts.css: --font-heading uses Outfit as first family', () => {
    const m = fontsCss.match(/--font-heading\s*:[^;]+;/);
    assert.ok(m, '--font-heading variable missing from fonts.css');
    assert.ok(m[0].includes('Outfit'), '--font-heading must lead with Outfit');
});

test('fonts.css: --font-code uses JetBrains Mono as first family', () => {
    const m = fontsCss.match(/--font-code\s*:[^;]+;/);
    assert.ok(m, '--font-code variable missing from fonts.css');
    assert.ok(m[0].includes('JetBrains Mono'), '--font-code must lead with JetBrains Mono');
});

test('fonts.css: --font-ar uses Tajawal for Arabic text', () => {
    const m = fontsCss.match(/--font-ar\s*:[^;]+;/);
    assert.ok(m, '--font-ar variable missing from fonts.css');
    assert.ok(m[0].includes('Tajawal'), '--font-ar must lead with Tajawal');
});

test('fonts.css: --font-steam uses Lato for Steam/login areas', () => {
    const m = fontsCss.match(/--font-steam\s*:[^;]+;/);
    assert.ok(m, '--font-steam variable missing from fonts.css');
    assert.ok(m[0].includes('Lato'), '--font-steam must lead with Lato');
});

test('fonts.css: references Montserrat font files from assets/fonts', () => {
    assert.ok(
        fontsCss.includes('Montserrat-VariableFont_wght.ttf'),
        'fonts.css must reference Montserrat-VariableFont_wght.ttf'
    );
});

test('fonts.css: references Outfit font file from assets/fonts', () => {
    assert.ok(
        fontsCss.includes('Outfit-VariableFont_wght.ttf'),
        'fonts.css must reference Outfit-VariableFont_wght.ttf'
    );
});

test('fonts.css: references Lufga font files from assets/fonts', () => {
    assert.ok(
        fontsCss.includes('Fontspring-DEMO-lufga-'),
        'fonts.css must reference Lufga font files from assets/fonts'
    );
});

test('fonts.css: Lufga covers at least thin(100), regular(400), extrabold(800) weights', () => {
    assert.match(fontsCss, /font-weight:\s*100/, 'Lufga must include weight 100 (thin)');
    assert.match(fontsCss, /font-weight:\s*400/, 'Lufga must include weight 400 (regular)');
    assert.match(fontsCss, /font-weight:\s*800/, 'Lufga must include weight 800 (extrabold)');
});

test('fonts.css: Montserrat is a variable font covering 100-900', () => {
    assert.match(fontsCss, /font-weight:\s*100\s+900/, 'Montserrat must be variable (100 900)');
});

test('fonts.css: Outfit is a variable font covering 100-900', () => {
    assert.match(fontsCss, /font-weight:\s*100\s+900/, 'Outfit must be variable (100 900)');
});

test('fonts.css: defines .font-ar utility class for Arabic text', () => {
    assert.match(fontsCss, /\.font-ar/, 'fonts.css must define .font-ar utility class');
    assert.match(fontsCss, /direction\s*:\s*rtl/, 'fonts.css .font-ar must set direction: rtl');
});

// ── All main CSS files import fonts.css ──────────────────────────────────────

const IMPORTING_FILES = [
    'dashboard.css',
    'game-details.css',
    'accounts.css',
    'addAccountModal.css',
    'addGameModal.css',
    'play-launcher.css',
];

for (const fname of IMPORTING_FILES) {
    test(`${fname}: imports fonts.css`, () => {
        const css = fs.readFileSync(path.join(CSS_DIR, fname), 'utf8');
        assert.match(css, /@import\s+url\(['"]\.\/fonts\.css['"]\)/, `${fname} must @import ./fonts.css`);
    });
}

// ── Brand font applied to display titles ─────────────────────────────────────

test('dashboard.css: .hero-game-title uses --font-brand', () => {
    const css = fs.readFileSync(path.join(CSS_DIR, 'dashboard.css'), 'utf8');
    assert.match(css, /\.hero-game-title[^}]*--font-brand/, '.hero-game-title must use var(--font-brand)');
});

test('dashboard.css: .brand-name uses --font-brand', () => {
    const css = fs.readFileSync(path.join(CSS_DIR, 'dashboard.css'), 'utf8');
    assert.match(css, /\.brand-name[^}]*--font-brand/, '.brand-name must use var(--font-brand)');
});

test('game-details.css: .gd-title uses --font-brand', () => {
    const css = fs.readFileSync(path.join(CSS_DIR, 'game-details.css'), 'utf8');
    assert.match(css, /\.gd-title[^}]*--font-brand/, '.gd-title must use var(--font-brand)');
});

test('play-launcher.css: .pl-game-name uses --font-brand', () => {
    const css = fs.readFileSync(path.join(CSS_DIR, 'play-launcher.css'), 'utf8');
    assert.match(css, /\.pl-game-name[^}]*--font-brand/, '.pl-game-name must use var(--font-brand)');
});

// ── No external CDN font sources in src/css/ ─────────────────────────────────

const CDN_PATTERNS = ['googleapis', 'gstatic', 'cdnjs', 'jsdelivr'];

const cssFiles = fs.readdirSync(CSS_DIR)
    .filter(f => f.endsWith('.css'))
    .map(f => ({ name: f, content: fs.readFileSync(path.join(CSS_DIR, f), 'utf8') }));

for (const { name, content } of cssFiles) {
    for (const cdn of CDN_PATTERNS) {
        test(`${name}: does not import from ${cdn}`, () => {
            assert.ok(
                !content.includes(cdn),
                `${name} references external CDN font source: ${cdn}`
            );
        });
    }
}

// ── fonts.css uses correct relative path to assets/fonts ─────────────────────

test('fonts.css: uses ../../assets/fonts/ relative path', () => {
    assert.match(
        fontsCss,
        /url\(['"]\.\.\/\.\.\/assets\/fonts\//,
        'fonts.css must use ../../assets/fonts/ path (relative from src/css/)'
    );
});

// ── No Montserrat/Outfit used without local @font-face in same file ───────────

for (const { name, content } of cssFiles) {
    test(`${name}: does not hard-code Montserrat without local @font-face`, () => {
        const hasMontserrat = content.includes('Montserrat');
        if (!hasMontserrat) return;
        // Allowed if accompanied by local @font-face OR by an @import of fonts.css
        const hasFontFace  = /@font-face[\s\S]*?Montserrat/.test(content);
        const hasImport    = content.includes("@import") && content.includes('fonts.css');
        assert.ok(
            hasFontFace || hasImport,
            `${name} uses Montserrat but has no local @font-face for it and does not import fonts.css`
        );
    });

    test(`${name}: does not hard-code Outfit without local @font-face`, () => {
        const hasOutfit = content.includes('Outfit');
        if (!hasOutfit) return;
        const hasFontFace = /@font-face[\s\S]*?Outfit/.test(content);
        const hasImport   = content.includes("@import") && content.includes('fonts.css');
        assert.ok(
            hasFontFace || hasImport,
            `${name} uses Outfit but has no local @font-face for it and does not import fonts.css`
        );
    });
}
