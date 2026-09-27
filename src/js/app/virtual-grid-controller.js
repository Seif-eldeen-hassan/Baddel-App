'use strict';

(function() {
    class BaddelVirtualGridController {
        constructor(options = {}) {
            this.name = options.name || 'virtual-grid';
            this.getScroller = options.getScroller;
            this.getKey = options.getKey;
            this.createCard = options.createCard;
            this.bindCard = options.bindCard;
            this.onRange = options.onRange || null;
            this.minCardWidth = Number(options.minCardWidth || 160);
            this.cardRatio = Number(options.cardRatio || 1.5);
            this.rowGap = Number(options.rowGap || 16);
            this.bufferRows = Number(options.bufferRows || 2);
            this.layout = options.layout === 'list' ? 'list' : 'grid';
            this.fixedRowHeight = Number(options.rowHeight || 0);
            this.stickyInset = Number(options.stickyInset || 0);
            this.items = [];
            this.host = null;
            this.context = null;
            this.scroller = null;
            this.mounted = new Map();
            this.freeCards = [];
            this.columns = 1;
            this.cardWidth = this.minCardWidth;
            this.cardHeight = Math.round(this.cardWidth * this.cardRatio);
            this.rowHeight = this.cardHeight + this.rowGap;
            this.totalHeight = 0;
            this.renderedStart = -1;
            this.renderedEnd = -1;
            this.raf = 0;
            this.generation = 0;
            this.userScrollRevision = 0;
            this._onScroll = () => { this.userScrollRevision += 1; this.schedule(false); };
            this._onResize = () => this.render(true);
        }

        mount({ host, items = [], context = null, resetScroll = false, scrollPolicy = resetScroll ? 'account-start' : 'preserve-position' } = {}) {
            this.cleanup(false);
            this.host = host;
            this.items = Array.isArray(items) ? items : [];
            this.context = context;
            this.generation += 1;
            this.renderedStart = -1;
            this.renderedEnd = -1;
            this.scroller = typeof this.getScroller === 'function' ? this.getScroller() : null;
            if (!this.host || !this.scroller) return;
            this.host.classList?.add?.('vault-virtual-grid');
            this.host.style.position = 'relative';
            this.host.textContent = '';
            this.scroller.addEventListener?.('scroll', this._onScroll, { passive: true });
            window.addEventListener?.('resize', this._onResize, { passive: true });
            this.render(true);
            if (resetScroll || scrollPolicy === 'account-start' || scrollPolicy === 'results-start') {
                this._scrollToResultsStart();
                this.render(true);
            }
        }

        cleanup(clearHost = false) {
            if (this.raf) {
                const cancel = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout;
                cancel(this.raf);
                this.raf = 0;
            }
            this.scroller?.removeEventListener?.('scroll', this._onScroll);
            window.removeEventListener?.('resize', this._onResize);
            for (const card of this.mounted.values()) {
                card.remove?.();
                this._release(card);
            }
            this.mounted.clear();
            this.renderedStart = -1;
            this.renderedEnd = -1;
            if (clearHost && this.host) this.host.textContent = '';
        }

        schedule(force = false) {
            if (this.raf) return;
            const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn) => setTimeout(fn, 0);
            this.raf = raf(() => {
                this.raf = 0;
                this.render(force);
            });
        }

        render(force = false, rebind = false) {
            if (!this.host || !this.scroller) return;
            this._measure();
            if (!this.items.length) {
                this.host.style.height = '0px';
                for (const [key, card] of Array.from(this.mounted.entries())) {
                    card.remove?.();
                    this.mounted.delete(key);
                    this._release(card);
                }
                this.renderedStart = 0;
                this.renderedEnd = 0;
                this.onRange?.({ start: 0, end: 0, firstRow: 0, lastRow: -1, scrollTop: 0, mounted: 0, columns: this.columns, total: 0, generation: this.generation });
                return;
            }
            const range = this._range();
            if (!force && range.start === this.renderedStart && range.end === this.renderedEnd) return;
            const neededKeys = new Set();
            for (let index = range.start; index < range.end; index += 1) {
                const item = this.items[index];
                if (!item) continue;
                neededKeys.add(String(this.getKey?.(item, index) || index));
            }
            for (const [key, card] of Array.from(this.mounted.entries())) {
                const idx = Number(card.dataset.virtualIndex || -1);
                if (idx < range.start || idx >= range.end || !neededKeys.has(key)) {
                    card.remove?.();
                    this.mounted.delete(key);
                    this._release(card);
                }
            }
            const fragment = document.createDocumentFragment();
            for (let index = range.start; index < range.end; index += 1) {
                const item = this.items[index];
                if (!item) continue;
                const key = String(this.getKey?.(item, index) || index);
                let card = this.mounted.get(key);
                const wasMounted = !!card;
                if (!card) {
                    card = this.freeCards.pop() || this.createCard?.();
                    if (!card) continue;
                    this.mounted.set(key, card);
                }
                const indexText = String(index);
                const generationText = String(this.generation);
                if (rebind || !wasMounted || card.dataset.virtualIndex !== indexText || card.dataset.virtualGeneration !== generationText) {
                    this.bindCard?.(card, item, { index, key, generation: this.generation, context: this.context });
                }
                card.dataset.virtualIndex = indexText;
                card.dataset.virtualKey = key;
                card.dataset.virtualGeneration = generationText;
                const width = `${this.cardWidth}px`;
                const height = `${this.cardHeight}px`;
                const left = this.layout === 'list' ? `${this.contentOffsetLeft || 0}px` : `${(this.contentOffsetLeft || 0) + (index % this.columns) * (this.cardWidth + this.rowGap)}px`;
                const top = `${Math.floor(index / this.columns) * this.rowHeight}px`;
                if (card.style.position !== 'absolute') card.style.position = 'absolute';
                if (card.style.width !== width) card.style.width = width;
                if (card.style.height !== height) card.style.height = height;
                if (card.style.left !== left) card.style.left = left;
                if (card.style.top !== top) card.style.top = top;
                if (!card.isConnected) fragment.appendChild(card);
            }
            if (fragment.childNodes.length) this.host.appendChild(fragment);
            this.renderedStart = range.start;
            this.renderedEnd = range.end;
            this.onRange?.({ ...range, mounted: this.mounted.size, columns: this.columns, total: this.items.length, generation: this.generation });
        }

        captureAnchor() {
            if (!this.host || !this.scroller || !this.mounted.size) {
                return {
                    key: null,
                    index: 0,
                    offset: 0,
                    scrollTop: Number(this.scroller?.scrollTop || 0),
                    generation: this.generation,
                    userScrollRevision: this.userScrollRevision,
                };
            }
            const scrollerTop = Number(this.scroller.getBoundingClientRect?.().top || 0) + this.stickyInset;
            const cards = Array.from(this.mounted.values())
                .map((card) => ({
                    card,
                    key: String(card.dataset.virtualKey || ''),
                    index: Number(card.dataset.virtualIndex || 0),
                    top: Number(card.getBoundingClientRect?.().top ?? ((this.host.offsetTop || 0) + Number.parseFloat(card.style.top || '0') - Number(this.scroller.scrollTop || 0))),
                }))
                .sort((a, b) => Math.abs(a.top - scrollerTop) - Math.abs(b.top - scrollerTop) || a.index - b.index);
            const anchor = cards[0] || null;
            return {
                key: anchor?.key || null,
                index: anchor?.index || 0,
                offset: anchor ? anchor.top - scrollerTop : 0,
                scrollTop: Number(this.scroller.scrollTop || 0),
                generation: this.generation,
                userScrollRevision: this.userScrollRevision,
            };
        }

        updateItems(items = [], { context = this.context, preserveAnchor = null, resetScroll = false, scrollPolicy = resetScroll ? 'results-start' : 'preserve-anchor' } = {}) {
            return this.setItems(items, { context, preserveAnchor, resetScroll, scrollPolicy });
        }

        setItems(items = [], { context = this.context, preserveAnchor = null, resetScroll = false, scrollPolicy = resetScroll ? 'results-start' : 'preserve-position' } = {}) {
            const anchor = preserveAnchor || this.captureAnchor();
            const token = this.userScrollRevision;
            this.items = Array.isArray(items) ? items : [];
            this.context = context;
            this.generation += 1;
            this.renderedStart = -1;
            this.renderedEnd = -1;
            this.render(true);
            if ((resetScroll || scrollPolicy === 'results-start' || scrollPolicy === 'account-start') && this.scroller) {
                this._scrollToResultsStart();
                this.render(true);
                return;
            }
            if (scrollPolicy === 'preserve-position') {
                this.render(true);
                return;
            }
            if (scrollPolicy !== 'preserve-anchor' || !this.scroller || !this.host || !anchor) return;
            if (this.userScrollRevision !== token || anchor.userScrollRevision !== token) return;
            this._measure();
            let targetIndex = -1;
            if (anchor.key) targetIndex = this.items.findIndex((item, index) => String(this.getKey?.(item, index) || index) === anchor.key);
            if (targetIndex < 0 && Number.isFinite(anchor.index)) targetIndex = Math.min(this.items.length - 1, Math.max(0, anchor.index));
            const fallback = Math.max(0, Number(anchor.scrollTop || 0));
            const nextTop = targetIndex >= 0 ? this._scrollTopForIndex(targetIndex, Number(anchor.offset || 0)) : fallback;
            this.scroller.scrollTop = this._clampScrollTop(nextTop);
            this.render(true);
        }

        patch(predicate, patcher) {
            let count = 0;
            for (const card of this.mounted.values()) {
                if (predicate(card)) {
                    patcher(card);
                    count += 1;
                }
            }
            return count;
        }

        _hostBox() {
            const fallbackWidth = Number(this.host?.clientWidth || this.host?.getBoundingClientRect?.().width || 760);
            let paddingLeft = 0;
            let paddingRight = 0;
            let borderLeft = 0;
            let borderRight = 0;
            if (typeof getComputedStyle === 'function' && this.host) {
                const style = getComputedStyle(this.host);
                paddingLeft = Number.parseFloat(style.paddingLeft || '0') || 0;
                paddingRight = Number.parseFloat(style.paddingRight || '0') || 0;
                borderLeft = Number.parseFloat(style.borderLeftWidth || '0') || 0;
                borderRight = Number.parseFloat(style.borderRightWidth || '0') || 0;
            }
            const clientWidth = Math.max(1, Number(this.host?.clientWidth || fallbackWidth || 760));
            const contentWidth = Math.max(1, Math.floor(clientWidth - paddingLeft - paddingRight - borderLeft - borderRight));
            return { clientWidth, contentWidth, paddingLeft };
        }

        _measure() {
            const box = this._hostBox();
            const width = box.contentWidth;
            this.contentOffsetLeft = box.paddingLeft;
            this.columns = this.layout === 'list' ? 1 : Math.max(1, Math.floor((width + this.rowGap) / (this.minCardWidth + this.rowGap)));
            this.cardWidth = this.layout === 'list' ? width : Math.max(1, Math.floor((width - (this.columns - 1) * this.rowGap) / this.columns));
            this.cardHeight = this.layout === 'list' ? Math.max(1, this.fixedRowHeight || this.cardHeight || 90) : Math.round(this.cardWidth * this.cardRatio);
            this.rowHeight = this.cardHeight + this.rowGap;
            this.totalHeight = Math.ceil(this.items.length / this.columns) * this.rowHeight;
            this.host.style.height = `${this.totalHeight}px`;
        }

        _range() {
            const scrollTop = this._visibleStartInHost();
            const viewport = Math.max(360, Number(this.scroller.clientHeight || window.innerHeight || 720));
            const totalRows = Math.max(1, Math.ceil(this.items.length / this.columns));
            const firstRow = Math.max(0, Math.floor(scrollTop / this.rowHeight) - this.bufferRows);
            const lastRow = Math.min(totalRows - 1, Math.ceil((scrollTop + viewport) / this.rowHeight) + this.bufferRows);
            return { start: firstRow * this.columns, end: Math.min(this.items.length, (lastRow + 1) * this.columns), firstRow, lastRow, scrollTop };
        }

        _hostStartOffset() {
            const scrollerRect = this.scroller?.getBoundingClientRect?.();
            const hostRect = this.host?.getBoundingClientRect?.();
            if (scrollerRect && hostRect && Number.isFinite(scrollerRect.top) && Number.isFinite(hostRect.top)) {
                return Number(this.scroller?.scrollTop || 0) + Number(hostRect.top || 0) - Number(scrollerRect.top || 0);
            }
            return Number(this.host?.offsetTop || 0);
        }

        _visibleStartInHost() {
            return Math.max(0, Number(this.scroller?.scrollTop || 0) - this._hostStartOffset() + this.stickyInset);
        }

        _scrollTopForIndex(index, offset = 0) {
            const rowTop = Math.floor(index / Math.max(1, this.columns)) * this.rowHeight;
            return this._hostStartOffset() + rowTop - this.stickyInset - offset;
        }

        _scrollToResultsStart() {
            if (!this.scroller || !this.host) return;
            this._measure();
            this.scroller.scrollTop = this._clampScrollTop(this._scrollTopForIndex(0, 0));
            this.renderedStart = -1;
            this.renderedEnd = -1;
        }

        _clampScrollTop(value) {
            const max = Math.max(0, Number(this.scroller?.scrollHeight || 0) - Number(this.scroller?.clientHeight || 0));
            const next = Math.max(0, Number(value || 0));
            return max > 0 ? Math.min(next, max) : next;
        }

        _release(card) {
            if (!card) return;
            if (this.freeCards.length < 120) this.freeCards.push(card);
        }
    }

    window.BaddelVirtualGridController = BaddelVirtualGridController;
})();


