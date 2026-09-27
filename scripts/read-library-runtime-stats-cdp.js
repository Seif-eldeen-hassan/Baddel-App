#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const http = require('node:http');
const port = Number(process.argv.find(value => value.startsWith('--port='))?.slice(7) || 9223);
const out = process.argv.find(value => value.startsWith('--out='))?.slice(6) || 'docs/library-runtime-stats.json';
const getJson = path => new Promise((resolve, reject) => http.get({ host:'127.0.0.1', port, path }, response => { let body=''; response.on('data', chunk => { body += chunk; }); response.on('end', () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } }); }).on('error', reject));
(async () => {
    const target = (await getJson('/json')).find(item => item.type === 'page' && /dashboard\.html/.test(item.url));
    if (!target) throw new Error('Dashboard target unavailable');
    const socket = new WebSocket(target.webSocketDebuggerUrl); let nextId=0; const pending=new Map();
    await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
    socket.onmessage=event=>{const m=JSON.parse(event.data);const p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);};
    const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++nextId;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
    await send('Performance.enable');
    const evaluated = await send('Runtime.evaluate', { returnByValue:true, expression:`(() => {
        const cards = [...document.querySelectorAll('#allGamesGrid .game-card')];
        const firstCard = cards[0] || null;
        const firstCover = firstCard?.querySelector('.native-lazy-load') || null;
        const cardRect = firstCard?.getBoundingClientRect() || null;
        const coverRect = firstCover?.getBoundingClientRect() || null;
        const wrongCoverCount = cards.filter(card => {
            const game = card._vsBoundGame;
            const wanted = game ? String(_agResolveCardCoverPayload(game)?.cover || '') : '';
            const actual = card.querySelector('.native-lazy-load')?.getAttribute('src') || '';
            return Boolean(actual && wanted && actual !== wanted);
        }).length;
        return { viewport:{innerWidth:window.innerWidth,innerHeight:window.innerHeight,devicePixelRatio:window.devicePixelRatio,clientWidth:_vs.scroller?.clientWidth||0,clientHeight:_vs.scroller?.clientHeight||0,cols:_vs.cols,rowH:_vs.rowH,cardWidth:cardRect?.width||0,cardHeight:cardRect?.height||0,coverWidth:coverRect?.width||0,coverHeight:coverRect?.height||0,coverNaturalWidth:firstCover?.naturalWidth||0,coverNaturalHeight:firstCover?.naturalHeight||0,coverSrc:firstCover?.getAttribute('src')||'',coverDisplay:firstCover?.style?.display||'',coverComplete:firstCover?.complete||false,loadedCoverCount:cards.filter(card=>card.querySelector('.native-lazy-load.loaded')).length,visibleCoverCount:cards.filter(card=>{const img=card.querySelector('.native-lazy-load');return img&&img.style.display!=='none'&&img.naturalWidth>0;}).length}, gridThumbnailSourceCount:typeof _agGridThumbnailSourceUrls==='function'?_agGridThumbnailSourceUrls(_vs.items).length:0,allCacheGridThumbnailSourceCount:typeof _agGridThumbnailSourceUrls==='function'?_agGridThumbnailSourceUrls(window._allGamesCache||[]).length:0,artworkHydration:window.__agApplicationArtworkHydration?{status:window.__agApplicationArtworkHydration.status,completed:window.__agApplicationArtworkHydration.completed,total:window.__agApplicationArtworkHydration.total,error:window.__agApplicationArtworkHydration.error||null}:null,gridThumbnailMapSize:window.__agGridThumbnailByCover?.size||0,gridThumbnailSample:window.__agGridThumbnailByCover?.entries ? [...window.__agGridThumbnailByCover.entries()].slice(0,1) : [],itemCount:_vs.items.length,mountedCards:cards.length,retainedCards:_vs.retainedCards?.size||0,retainedCardBytes:_vs.retainedCardBytes||0,retainedCardBudgetBytes:_vs.retainedCardBudgetBytes||0,retainedCardStats:_vs.retainedCardStats||{},freeCards:_vs.freeCards.length,wrongCoverCount };
    })()` });
    const performance = await send('Performance.getMetrics');
    const metrics = Object.fromEntries((performance.metrics || []).map(metric => [metric.name, metric.value]));
    const result = { marker:'BADDEL_LIBRARY_RUNTIME_STATS', measuredAt:new Date().toISOString(), ...evaluated.result.value, metrics:{ JSHeapUsedSize:metrics.JSHeapUsedSize,JSHeapTotalSize:metrics.JSHeapTotalSize,Nodes:metrics.Nodes,LayoutCount:metrics.LayoutCount,RecalcStyleCount:metrics.RecalcStyleCount } };
    socket.close(); fs.writeFileSync(out,JSON.stringify(result,null,2)); console.log(JSON.stringify(result));
})().catch(error=>{console.error(error.stack||error);process.exit(1);});
