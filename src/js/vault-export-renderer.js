(function initializeVaultExportRenderer() {
    'use strict';

    const IMAGE_TIMEOUT_MS = 5000;
    const TILE_ARTWORK_TIMEOUT_MS = 10000;
    let snapshot = null;
    let readyPromise = null;
    let artworkFailures = 0;
    let documentHeight = 0;
    let captureViewport = null;

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = String(text);
        return node;
    }

    function appendMoneyLines(card, lines, emptyLabel = 'Not available') {
        for (const line of Array.isArray(lines) ? lines : []) card.append(el('span', 'money-line', line.text));
        if (!card.querySelector('.money-line')) card.append(el('span', 'money-line', emptyLabel));
    }

    function renderFinanceCard(label, lines, options = {}) {
        const card = el('article', `finance-card${options.primary ? ' primary' : ''}`);
        card.append(el('h2', '', label));
        appendMoneyLines(card, lines, options.emptyLabel);
        if (options.coverage) card.append(el('small', '', options.coverage));
        return card;
    }

    function financeCardDefinitions(data) {
        const options = data.displayOptions || { currentLibraryValue: true, totalPaid: true, totalRefunded: true, netSpend: true };
        return [
            options.currentLibraryValue && { key: 'currentLibraryValue', label: 'Current Epic Library Value', lines: data.financials.currentLibraryValue, primary: true, coverage: `Current value based on ${data.financials.currentValueCoverage} priced games` },
            options.totalPaid && { key: 'totalPaid', label: 'Total Paid', lines: data.financials.totalPaid, emptyLabel: data.financials.historyImported ? 'Not available' : 'Not imported' },
            options.totalRefunded && { key: 'totalRefunded', label: 'Refunds', lines: data.financials.totalRefunded, emptyLabel: data.financials.historyImported ? 'Not available' : 'Not imported' },
            options.netSpend && { key: 'netSpend', label: 'Net Spent', lines: data.financials.netSpend, emptyLabel: data.financials.historyImported ? 'Not available' : 'Not imported' },
        ].filter(Boolean);
    }

    function renderSnapshot(data) {
        snapshot = data;
        const date = new Date(data.generatedAt);
        document.getElementById('generatedDate').textContent = `Generated ${date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`;
        const priceDate = document.getElementById('priceDataDate');
        if (data.priceDataAt) {
            priceDate.textContent = `Prices updated ${new Date(data.priceDataAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`;
            priceDate.hidden = false;
        }
        const name = document.getElementById('displayName');
        if (data.displayName) { name.textContent = data.displayName; name.hidden = false; }
        const countSummary = document.getElementById('countSummary');
        const counts = [
            [data.counts.rawOwned, 'Total Library'],
            [data.counts.priced, 'Priced'],
            [data.counts.freeExcluded, 'Free'],
            [data.counts.priceUnavailable, 'Price Unavailable'],
        ];
        for (const [value, label] of counts) {
            const chip = el('div', 'count-chip');
            chip.append(el('strong', '', value), el('span', '', label));
            countSummary.append(chip);
        }
        const finance = document.getElementById('financeGrid');
        const cards = financeCardDefinitions(data).map((definition) => renderFinanceCard(definition.label, definition.lines, {
            primary: definition.primary,
            coverage: definition.coverage,
            emptyLabel: definition.emptyLabel,
        }));
        finance.hidden = cards.length === 0;
        finance.style.setProperty('--finance-count', String(Math.max(1, cards.length)));
        document.querySelector('.showcase-header')?.classList.toggle('games-only', cards.length === 0);
        finance.append(...cards);
        const sectionsHost = document.getElementById('sections');
        for (const section of data.sections) {
            if (!section.games.length) continue;
            const sectionEl = el('section', 'game-section');
            const heading = el('div', 'section-heading');
            heading.append(el('h2', '', section.title), el('span', '', section.count));
            const grid = el('div', 'poster-grid');
            for (const game of section.games) {
                const poster = el('div', 'poster');
                poster.dataset.key = game.key;
                const image = el('img');
                image.alt = '';
                if (game.coverSource) image.dataset.src = game.coverSource;
                const fallback = el('div', 'poster-placeholder');
                fallback.append(el('span', '', game.title));
                poster.append(image, fallback);
                grid.append(poster);
            }
            sectionEl.append(heading, grid);
            sectionsHost.append(sectionEl);
        }
        [...document.querySelectorAll('.poster')].forEach((poster, index) => { poster.dataset.exportTop = String(Math.round(poster.getBoundingClientRect().top)); poster.dataset.exportIndex = String(index); });
    }

    function loadImage(image) {
        if (!image?.dataset?.src || image.dataset.state === 'loaded' || image.dataset.state === 'failed') return Promise.resolve();
        image.dataset.state = 'loading';
        image.src = image.dataset.src;
        return new Promise((resolve) => {
            let settled = false;
            const done = (ok) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                image.dataset.state = ok ? 'loaded' : 'failed';
                image.closest('.poster')?.classList.toggle('loaded', ok);
                if (!ok) artworkFailures += 1;
                resolve();
            };
            const timer = setTimeout(() => done(false), IMAGE_TIMEOUT_MS);
            image.onload = () => image.decode?.().then(() => done(true), () => done(false)) || done(true);
            image.onerror = () => done(false);
            if (image.complete) done(image.naturalWidth > 0);
        });
    }

    async function waitForStableTilePosition(showcase, expectedTop) {
        let actualTop = Number.NaN;
        for (let attempt = 0; attempt < 4; attempt += 1) {
            void showcase.offsetHeight;
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            actualTop = showcase.getBoundingClientRect().top;
            if (Math.abs(actualTop - expectedTop) <= 1) return actualTop;
        }
        throw new Error(`Export tile position did not settle: expected ${expectedTop}, received ${actualTop}.`);
    }

    function visiblePosterRange(top, bottom) {
        const visible = [...document.querySelectorAll('.poster')].filter((poster) => {
            const posterTop = Number(poster.dataset.exportTop || 0);
            return posterTop < bottom && posterTop + Number(poster.offsetHeight || 0) > top;
        });
        const first = visible[0];
        const last = visible.at(-1);
        return {
            firstPosterKey: first?.dataset?.key || null,
            firstPosterIndex: first ? Number(first.dataset.exportIndex) : null,
            lastPosterKey: last?.dataset?.key || null,
            lastPosterIndex: last ? Number(last.dataset.exportIndex) : null,
        };
    }

    async function prepareTile(offset, height) {
        const top = Math.max(0, Number(offset) || 0);
        const tileHeight = Math.max(1, Number(height) || captureViewport?.height || window.innerHeight);
        const bottom = top + tileHeight;
        const candidates = [...document.querySelectorAll('.poster img')].filter((image) => {
            const poster = image.closest('.poster');
            const absoluteTop = Number(poster?.dataset?.exportTop || 0);
            const posterHeight = Number(poster?.offsetHeight || 0);
            return absoluteTop < bottom + 400 && absoluteTop + posterHeight > top - 400;
        });
        let cursor = 0;
        const workers = Array.from({ length: Math.min(6, candidates.length) }, async () => {
            while (cursor < candidates.length) await loadImage(candidates[cursor++]);
        });
        let tileTimer = null;
        await Promise.race([
            Promise.all(workers),
            new Promise((resolve) => { tileTimer = setTimeout(resolve, TILE_ARTWORK_TIMEOUT_MS); }),
        ]).finally(() => clearTimeout(tileTimer));
        for (const image of candidates.filter((item) => item.dataset.state === 'loading')) {
            image.dataset.state = 'failed';
            artworkFailures += 1;
        }
        const showcase = document.getElementById('showcase');
        const expectedTop = -top;
        showcase.style.top = `${expectedTop}px`;
        const actualShowcaseTop = await waitForStableTilePosition(showcase, expectedTop);
        return {
            offset: top,
            height: tileHeight,
            artworkFailures,
            actualShowcaseTop,
            expectedShowcaseTop: expectedTop,
            viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio || 1 },
            ...visiblePosterRange(top, bottom),
        };
    }

    async function confirmTile(offset) {
        const expectedTop = -Math.max(0, Number(offset) || 0);
        const showcase = document.getElementById('showcase');
        const actualShowcaseTop = await waitForStableTilePosition(showcase, expectedTop);
        return { actualShowcaseTop, expectedShowcaseTop: expectedTop, viewport: { ...captureViewport } };
    }
    function exportGeometrySnapshot() {
        const rect = (node) => {
            const value = node?.getBoundingClientRect?.();
            return value ? { top: value.top, bottom: value.bottom, height: value.height } : null;
        };
        const posters = [...document.querySelectorAll('.poster')];
        const rowMap = new Map();
        for (const poster of posters) {
            const value = rect(poster);
            const key = Math.round(value.top);
            const row = rowMap.get(key) || { top: value.top, bottom: value.bottom, count: 0 };
            row.count += 1;
            row.bottom = Math.max(row.bottom, value.bottom);
            rowMap.set(key, row);
        }
        return {
            headerCount: document.querySelectorAll('.showcase-header').length,
            countChipCount: document.querySelectorAll('#countSummary .count-chip').length,
            countChipLabels: [...document.querySelectorAll('#countSummary .count-chip span')].map((node) => node.textContent),
            sectionPosterCounts: [...document.querySelectorAll('.game-section')].map((section) => {
                const sectionPosters = [...section.querySelectorAll('.poster')];
                return {
                    title: section.querySelector('.section-heading h2')?.textContent || '',
                    count: sectionPosters.length,
                    firstIndex: sectionPosters.length ? Number(sectionPosters[0].dataset.exportIndex) : null,
                    lastIndex: sectionPosters.length ? Number(sectionPosters.at(-1).dataset.exportIndex) : null,
                };
            }),
            pricedHeadingCount: [...document.querySelectorAll('.section-heading h2')].filter((node) => node.textContent === 'Priced Games').length,
            priceUnavailableHeadingCount: [...document.querySelectorAll('.section-heading h2')].filter((node) => node.textContent === 'Price Unavailable').length,
            footerCount: document.querySelectorAll('[data-export-marker="footer"]').length,
            header: rect(document.querySelector('.showcase-header')),
            footer: rect(document.querySelector('[data-export-marker="footer"]')),
            lastPosterBottom: posters.length ? Math.max(...posters.map((poster) => rect(poster).bottom)) : null,
            posterCount: posters.length,
            uniquePosterKeyCount: new Set(posters.map((poster) => poster.dataset.key)).size,
            posterRows: [...rowMap.values()].sort((a, b) => a.top - b.top),
        };
    }

    async function initialize() {
        const data = await window.vaultExportAPI.getSnapshot();
        if (!data || data.schemaVersion !== 1) throw new Error('Invalid Vault export snapshot.');
        renderSnapshot(data);
        await document.fonts?.ready;
        await Promise.all([...document.images]
            .filter((image) => !image.closest('.poster'))
            .map((image) => image.decode?.().catch(() => {}) || Promise.resolve()));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const showcase = document.getElementById('showcase');
        documentHeight = Math.ceil(showcase.getBoundingClientRect().height);
        captureViewport = { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio || 1 };
        document.documentElement.style.height = `${captureViewport.height}px`;
        document.body.style.height = `${captureViewport.height}px`;
        showcase.style.position = 'absolute';
        showcase.style.left = '0';
        showcase.style.top = '0';
        await waitForStableTilePosition(showcase, 0);
        return { width: Math.round(showcase.getBoundingClientRect().width), height: documentHeight, artworkFailures, viewport: { ...captureViewport }, markers: exportGeometrySnapshot() };
    }

    readyPromise = initialize();
    window.vaultExportRenderer = Object.freeze({
        whenReady: () => readyPromise,
        prepareTile,
        confirmTile,
        financeCardDefinitions,
        dimensions: () => ({
            width: Math.round(document.getElementById('showcase').getBoundingClientRect().width),
            height: documentHeight,
            artworkFailures,
            viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio || 1 },
        }),
    });
}());
