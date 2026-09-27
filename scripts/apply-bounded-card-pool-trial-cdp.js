#!/usr/bin/env node
'use strict';

const http = require('node:http');

const arg = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
const port = Number(arg('port', '9223'));
const limit = Number(arg('limit', '512'));

function getJson(path) {
    return new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port, path }, response => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', chunk => { body += chunk; });
            response.on('end', () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
        }).on('error', reject);
    });
}

(async () => {
    const target = (await getJson('/json')).find(item => item.type === 'page' && /dashboard\.html/.test(item.url));
    if (!target) throw new Error('Dashboard target unavailable');
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    const result = await new Promise((resolve, reject) => {
        socket.onmessage = event => {
            const message = JSON.parse(event.data);
            if (message.id !== 1) return;
            message.error ? reject(new Error(message.error.message)) : resolve(message.result);
        };
        socket.send(JSON.stringify({
            id: 1,
            method: 'Runtime.evaluate',
            params: {
                awaitPromise: true,
                returnByValue: true,
                expression: `(() => {
                    const limit = ${JSON.stringify(limit)};
                    _vs.retainedCards = new Map();
                    _vs.retainedCardStats = { hits: 0, misses: 0, evictions: 0, peak: 0, limit };
                    _vsReleaseRow = function (rowIdx, rowEl) {
                        if (!rowEl) return 0;
                        let released = 0;
                        const cards = Array.from(rowEl.children || []).filter(el => el?.classList?.contains('game-card'));
                        for (const card of cards) {
                            const id = String(card.dataset?.id || '');
                            if (id) {
                                _vs.cardCache?.delete?.(id);
                                _vs.visibleCardsByGameId?.delete?.(id);
                            }
                            card.dataset.poolState = 'retained';
                            card.remove();
                            if (id) {
                                _vs.retainedCards.delete(id);
                                _vs.retainedCards.set(id, card);
                            } else {
                                _vs.freeCards.push(card);
                            }
                            while (_vs.retainedCards.size > limit) {
                                const oldest = _vs.retainedCards.keys().next().value;
                                const evicted = _vs.retainedCards.get(oldest);
                                _vs.retainedCards.delete(oldest);
                                if (evicted) _vs.freeCards.push(evicted);
                                _vs.retainedCardStats.evictions++;
                            }
                            _vs.retainedCardStats.peak = Math.max(_vs.retainedCardStats.peak, _vs.retainedCards.size);
                            released++;
                        }
                        rowEl.remove();
                        _vs.rowBindings?.delete?.(rowIdx);
                        return released;
                    };
                    _vsAcquireCard = function (game) {
                        const gameId = _agGameKey(game);
                        let card = _vs.retainedCards.get(gameId);
                        if (card) {
                            _vs.retainedCards.delete(gameId);
                            _vs.retainedCardStats.hits++;
                            card._vsBoundGame = game;
                        } else {
                            _vs.retainedCardStats.misses++;
                            card = _vs.freeCards.pop();
                            if (card) _vsBindCard(card, game);
                            else card = _vsBuildCard(game);
                        }
                        card.dataset.poolState = 'mounted';
                        _vs.cardCache.set(gameId, card);
                        _vs.visibleCardsByGameId.set(gameId, card);
                        return card;
                    };
                    return { installed: true, limit };
                })()`,
            },
        }));
    });
    console.log(JSON.stringify(result.result?.value || result));
    socket.close();
})().catch(error => { console.error(error); process.exitCode = 1; });
