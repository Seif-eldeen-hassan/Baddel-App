'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const controllerSource = fs.readFileSync(path.join(ROOT, 'src/js/app/virtual-grid-controller.js'), 'utf8');
const sidebarSource = fs.readFileSync(path.join(ROOT, 'src/js/app/sidebar.js'), 'utf8');
const dashboardSource = fs.readFileSync(path.join(ROOT, 'src/dashboard.html'), 'utf8');

function makeDom() {
  class ClassList { add() {} remove() {} }
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.childNodes = this.children;
      this.dataset = {};
      this.style = {};
      this.classList = new ClassList();
      this.isConnected = false;
      this.clientWidth = 1000;
      this.clientHeight = 720;
      this.offsetTop = 0;
      this.listeners = new Map();
    }
    appendChild(child) {
      if (child.tagName === 'FRAGMENT') {
        for (const grand of [...child.children]) this.appendChild(grand);
        child.children.length = 0;
        return child;
      }
      child.isConnected = true;
      this.children.push(child);
      return child;
    }
    remove() { this.isConnected = false; }
    addEventListener(type, fn, opts) { this.listeners.set(type, { fn, opts }); }
    removeEventListener(type) { this.listeners.delete(type); }
    getBoundingClientRect() { return { width: this.clientWidth }; }
  }
  const host = new Element('div');
  const scroller = new Element('div');
  scroller.clientHeight = 720;
  scroller.scrollTop = 0;
  const document = {
    createElement: (tag) => new Element(tag),
    createDocumentFragment: () => new Element('fragment'),
  };
  const sandbox = {
    window: { addEventListener() {}, removeEventListener() {}, innerHeight: 720 },
    document,
    setTimeout: (fn) => { fn(); return 1; },
    clearTimeout() {},
    requestAnimationFrame: (fn) => { fn(); return 1; },
    cancelAnimationFrame() {},
    getComputedStyle: (el) => el.__computedStyle || { paddingLeft: '0px', paddingRight: '0px', borderLeftWidth: '0px', borderRightWidth: '0px' },
  };
  sandbox.globalThis = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(controllerSource, sandbox);
  return { sandbox, host, scroller };
}

function mountCountFor(total) {
  const { sandbox, host, scroller } = makeDom();
  const Controller = sandbox.window.BaddelVirtualGridController;
  let builds = 0;
  let binds = 0;
  const controller = new Controller({
    getScroller: () => scroller,
    minCardWidth: 160,
    cardRatio: 1.5,
    rowGap: 18,
    bufferRows: 3,
    getKey: (item) => item.id,
    createCard: () => { builds += 1; return sandbox.document.createElement('article'); },
    bindCard: () => { binds += 1; },
  });
  controller.mount({ host, items: Array.from({ length: total }, (_, i) => ({ id: `game-${i}` })) });
  return { mounted: controller.mounted.size, builds, binds, controller, host, scroller };
}

test('Epic Vault shared virtual grid mounts only viewport plus buffer for 600 games', () => {
  const result = mountCountFor(600);
  assert.ok(result.mounted > 0);
  assert.ok(result.mounted <= 60, `mounted ${result.mounted}`);
  assert.ok(result.builds <= result.mounted);
});

test('Epic Vault shared virtual grid does not mount all cards for 2000 games', () => {
  const result = mountCountFor(2000);
  assert.ok(result.mounted < 100, `mounted ${result.mounted}`);
  assert.ok(result.mounted < 2000);
});

test('Epic Vault scroll binds only newly visible cards while artwork refresh can explicitly rebind mounted cards', () => {
  const result = mountCountFor(600);
  let binds = result.binds;
  const originalBind = result.controller.bindCard;
  result.controller.bindCard = (...args) => { binds += 1; return originalBind?.(...args); };
  result.scroller.scrollTop = result.controller.rowHeight * 2;
  result.controller.render(false);
  const scrollBinds = binds - result.binds;
  assert.ok(scrollBinds > 0, 'newly visible cards should bind');
  assert.ok(scrollBinds < result.mounted, `scroll rebound ${scrollBinds} of ${result.mounted} mounted cards`);
  const beforeRefresh = binds;
  result.controller.render(true, true);
  assert.equal(binds - beforeRefresh, result.controller.mounted.size);
});

test('Epic Vault shared virtual grid uses passive main scroll owner and cleanup removes listeners', () => {
  const { sandbox, host, scroller } = makeDom();
  const controller = new sandbox.window.BaddelVirtualGridController({
    getScroller: () => scroller,
    getKey: (item) => item.id,
    createCard: () => sandbox.document.createElement('article'),
    bindCard() {},
  });
  controller.mount({ host, items: [{ id: 'a' }] });
  assert.equal(scroller.listeners.get('scroll').opts.passive, true);
  controller.cleanup();
  assert.equal(scroller.listeners.has('scroll'), false);
});

test('Epic Vault render path has no per-card IPC, network, or full host HTML replacement during scroll', () => {
  const frame = sidebarSource.slice(sidebarSource.indexOf('function _vaultRenderLibraryVirtualFrame'), sidebarSource.indexOf('function _vaultScheduleLibraryVirtual'));
  const controllerRender = controllerSource.slice(controllerSource.indexOf('render(force'), controllerSource.indexOf('_measure()'));
  assert.doesNotMatch(`${frame}\n${controllerRender}`, /getCachedImagesBulk|cacheImage|cacheAllAssets|getMetadata|fetch\(|platformSyncSync|platformSyncLink/);
  assert.doesNotMatch(controllerRender, /innerHTML\s*=|replaceChildren|textContent\s*=/);
});

test('Epic Vault local artwork pipeline performs one bulk cache lookup and no remote DOM candidate serialization', () => {
  const prime = sidebarSource.slice(sidebarSource.indexOf('function _vaultPrimeLocalCovers'), sidebarSource.indexOf('function _vaultPatchMountedCover'));
  const render = sidebarSource.slice(sidebarSource.indexOf('function _vaultRenderEpicCover'), sidebarSource.indexOf('function _vaultGetCurrentPriceView'));
  assert.match(prime, /getCachedImagesBulk\(identities, 'cover'\)/);
  assert.match(prime, /identities\.push\(\{ key, ids:/);
  assert.doesNotMatch(render, /candidates\[0\]\.url|data-cover-candidates|https?:\/\//);
});

test('Epic Vault opens from local persisted data and does not start auth or sync on open', () => {
  const hydrate = sidebarSource.slice(sidebarSource.indexOf('async function hydrateEpicVaultConsole'), sidebarSource.indexOf('function setVaultEpicPriceMode'));
  assert.match(hydrate, /VaultHydrationClient/);
  assert.match(hydrate, /requestSnapshot\(window\.electronAPI/);
  assert.doesNotMatch(hydrate, /platformSyncSync|platformSyncLink|openEpicLoginWindow|runLegendary|auth --code/);
});

test('Epic Vault script loads shared controller before sidebar and All Games script order remains after Vault', () => {
  assert.ok(dashboardSource.indexOf('js/app/virtual-grid-controller.js') < dashboardSource.indexOf('js/app/sidebar.js'));
  assert.ok(dashboardSource.indexOf('js/app/sidebar.js') < dashboardSource.indexOf('js/accounts.js'));
});

test('Epic Vault virtual grid preserves semantic anchor when rows are inserted before viewport', () => {
  const { sandbox, host, scroller } = makeDom();
  host.offsetTop = 120;
  const Controller = sandbox.window.BaddelVirtualGridController;
  const controller = new Controller({
    getScroller: () => scroller,
    minCardWidth: 160,
    cardRatio: 1.5,
    rowGap: 18,
    bufferRows: 2,
    getKey: (item) => item.id,
    createCard: () => sandbox.document.createElement('article'),
    bindCard() {},
  });
  const initial = Array.from({ length: 600 }, (_, i) => ({ id: `game-${i}` }));
  controller.mount({ host, items: initial });
  controller._measure();
  scroller.scrollTop = host.offsetTop + controller.rowHeight * 30 + 11;
  controller.render(true);
  const anchor = controller.captureAnchor();
  const next = [
    ...Array.from({ length: 10 }, (_, i) => ({ id: `inserted-${i}` })),
    ...initial,
  ];
  controller.updateItems(next, { preserveAnchor: anchor, resetScroll: false });
  const after = controller.captureAnchor();
  assert.equal(after.key, anchor.key);
  assert.ok(Math.abs(after.offset - anchor.offset) <= 1, `offset moved ${anchor.offset} -> ${after.offset}`);
  assert.ok(scroller.scrollTop > anchor.scrollTop, 'scrollTop should compensate for inserted rows');
});

test('Epic Vault virtual grid keeps user scroll when stale async anchor is obsolete', () => {
  const { sandbox, host, scroller } = makeDom();
  const Controller = sandbox.window.BaddelVirtualGridController;
  const controller = new Controller({
    getScroller: () => scroller,
    getKey: (item) => item.id,
    createCard: () => sandbox.document.createElement('article'),
    bindCard() {},
  });
  const initial = Array.from({ length: 300 }, (_, i) => ({ id: `game-${i}` }));
  controller.mount({ host, items: initial });
  scroller.scrollTop = controller.rowHeight * 20;
  controller.render(true);
  const staleAnchor = controller.captureAnchor();
  scroller.scrollTop += 777;
  controller.userScrollRevision += 1;
  const userTop = scroller.scrollTop;
  controller.updateItems(initial.slice(), { preserveAnchor: staleAnchor, resetScroll: false });
  assert.equal(scroller.scrollTop, userTop);
});

test('Epic Vault cover patching does not affect virtual scroll position', () => {
  const result = mountCountFor(600);
  result.scroller.scrollTop = 2400;
  const before = result.scroller.scrollTop;
  const patched = result.controller.patch(() => true, (card) => { card.dataset.cover = 'ready'; });
  assert.ok(patched > 0);
  assert.equal(result.scroller.scrollTop, before);
});

test('Epic Vault virtual grid results-start clamps a shrunk dataset and renders immediately', () => {
  const { sandbox, host, scroller } = makeDom();
  const Controller = sandbox.window.BaddelVirtualGridController;
  const controller = new Controller({
    getScroller: () => scroller,
    minCardWidth: 160,
    cardRatio: 1.5,
    rowGap: 18,
    bufferRows: 2,
    getKey: (item) => item.id,
    createCard: () => sandbox.document.createElement('article'),
    bindCard(card, item) { card.dataset.boundTitle = item.title; },
  });
  controller.mount({ host, items: Array.from({ length: 600 }, (_, i) => ({ id: `game-${i}`, title: `Game ${i}` })) });
  scroller.scrollTop = controller.rowHeight * 80;
  controller.render(true);
  controller.setItems(Array.from({ length: 8 }, (_, i) => ({ id: `small-${i}`, title: `Small ${i}` })), { scrollPolicy: 'results-start' });
  assert.equal(controller.renderedStart, 0);
  assert.ok(controller.renderedEnd > 0);
  assert.ok(controller.renderedEnd <= 8);
  assert.ok(controller.mounted.size > 0);
});

test('Epic Vault list-mode virtual controller reaches first middle and last history rows with bounded DOM', () => {
  const { sandbox, host, scroller } = makeDom();
  host.clientWidth = 900;
  scroller.clientHeight = 360;
  const Controller = sandbox.window.BaddelVirtualGridController;
  const seen = new Set();
  const controller = new Controller({
    layout: 'list',
    rowHeight: 90,
    rowGap: 10,
    bufferRows: 3,
    getScroller: () => scroller,
    getKey: (item) => item.id,
    createCard: () => sandbox.document.createElement('article'),
    bindCard(card, item) { card.dataset.boundTitle = item.title; seen.add(item.id); },
  });
  const items = Array.from({ length: 100 }, (_, i) => ({ id: `order-${i}`, title: `Order ${i}` }));
  controller.mount({ host, items, scrollPolicy: 'results-start' });
  assert.ok(seen.has('order-0'));
  scroller.scrollTop = 50 * controller.rowHeight;
  controller.render(true);
  assert.ok(seen.has('order-50'));
  scroller.scrollTop = 99 * controller.rowHeight;
  controller.render(true);
  assert.ok(seen.has('order-99'));
  assert.ok(controller.mounted.size <= 14, `mounted ${controller.mounted.size}`);
});

test('Epic Vault virtual grid removes stale mounted keys when filter changes within same range', () => {
  const { sandbox, host, scroller } = makeDom();
  host.clientWidth = 900;
  scroller.clientHeight = 420;
  const Controller = sandbox.window.BaddelVirtualGridController;
  const controller = new Controller({
    getScroller: () => scroller,
    minCardWidth: 160,
    cardRatio: 1.5,
    rowGap: 18,
    bufferRows: 1,
    getKey: (item) => item.id,
    createCard: () => sandbox.document.createElement('article'),
    bindCard(card, item) { card.dataset.boundTitle = item.title; },
  });
  const priced = Array.from({ length: 18 }, (_, i) => ({ id: `priced-${i}`, title: `Priced ${i}` }));
  const free = Array.from({ length: 8 }, (_, i) => ({ id: `free-${i}`, title: `Free ${i}` }));
  controller.mount({ host, items: priced, scrollPolicy: 'results-start' });
  controller.setItems(free, { scrollPolicy: 'results-start' });
  const connectedTitles = Array.from(controller.mounted.values()).map((card) => card.dataset.boundTitle || '');
  assert.ok(connectedTitles.length > 0);
  assert.ok(connectedTitles.every((title) => title.startsWith('Free ')), connectedTitles.join(', '));
  assert.equal(controller.mounted.size, connectedTitles.length);
});



test('Epic Vault virtual grid measures inner host width and keeps last column inside bounds', () => {
  const { sandbox, host, scroller } = makeDom();
  host.clientWidth = 1001;
  host.__computedStyle = { paddingLeft: '13px', paddingRight: '17px', borderLeftWidth: '1px', borderRightWidth: '1px' };
  scroller.clientHeight = 520;
  const Controller = sandbox.window.BaddelVirtualGridController;
  const controller = new Controller({
    getScroller: () => scroller,
    minCardWidth: 160,
    cardRatio: 1.5,
    rowGap: 18,
    bufferRows: 1,
    getKey: (item) => item.id,
    createCard: () => sandbox.document.createElement('article'),
    bindCard() {},
  });
  controller.mount({ host, items: Array.from({ length: 60 }, (_, i) => ({ id: `game-${i}` })) });
  const available = 1001 - 13 - 17 - 1 - 1;
  assert.equal(controller.contentOffsetLeft, 13);
  for (const card of controller.mounted.values()) {
    const left = Number.parseFloat(card.style.left || '0') - controller.contentOffsetLeft;
    const right = left + Number.parseFloat(card.style.width || '0');
    assert.ok(right <= available, `card right ${right} exceeded ${available}`);
  }
});

test('Epic Vault list mode uses inner width for history rows without creating horizontal overflow', () => {
  const { sandbox, host, scroller } = makeDom();
  host.clientWidth = 640;
  host.__computedStyle = { paddingLeft: '12px', paddingRight: '12px', borderLeftWidth: '0px', borderRightWidth: '0px' };
  scroller.clientHeight = 360;
  const Controller = sandbox.window.BaddelVirtualGridController;
  const controller = new Controller({
    layout: 'list',
    rowHeight: 90,
    rowGap: 10,
    bufferRows: 2,
    getScroller: () => scroller,
    getKey: (item) => item.id,
    createCard: () => sandbox.document.createElement('article'),
    bindCard() {},
  });
  controller.mount({ host, items: Array.from({ length: 100 }, (_, i) => ({ id: `order-${i}` })) });
  for (const card of controller.mounted.values()) {
    const left = Number.parseFloat(card.style.left || '0');
    const width = Number.parseFloat(card.style.width || '0');
    assert.equal(left, 12);
    assert.ok(left + width <= 640 - 12, `row right ${left + width} exceeded host inner edge`);
  }
});