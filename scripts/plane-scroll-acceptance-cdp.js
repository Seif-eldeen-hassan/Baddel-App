#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const http = require('node:http');
const { performance } = require('node:perf_hooks');

const arg = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
const port = Number(arg('port', '9223'));
const durationMs = Number(arg('durationMs', '20000'));
const eventIntervalMs = Number(arg('eventIntervalMs', '16'));
const deltaY = Number(arg('deltaY', '180'));
const phaseMs = Number(arg('phaseMs', '2500'));
const syntheticCount = Number(arg('syntheticCount', '0'));
const out = arg('out', 'docs/plane-scroll-acceptance.json');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const getJson = requestPath => new Promise((resolve, reject) => http.get({ host:'127.0.0.1', port, path:requestPath }, response => { let body=''; response.on('data', chunk => { body += chunk; }); response.on('end', () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } }); }).on('error', reject));

function connect(url) {
    const socket = new WebSocket(url); let nextId = 0; const pending = new Map();
    const opened = new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    socket.onmessage = event => { const message=JSON.parse(event.data); const job=pending.get(message.id); if(!job)return; pending.delete(message.id); message.error?job.reject(new Error(message.error.message)):job.resolve(message.result); };
    return { async send(method,params={}) { await opened; const id=++nextId; socket.send(JSON.stringify({id,method,params})); return new Promise((resolve,reject)=>pending.set(id,{resolve,reject})); }, close(){socket.close();} };
}

(async () => {
    const target=(await getJson('/json')).find(item=>item.type==='page'&&/dashboard\.html/.test(item.url));
    if(!target) throw new Error('Dashboard target unavailable');
    const client=connect(target.webSocketDebuggerUrl);
    await client.send('Page.bringToFront');
    if (syntheticCount > 0) {
        await client.send('Runtime.evaluate', { awaitPromise:true, expression:`(() => {
            const source=Array.from(_vs.items||[]); if(!source.length) throw new Error('Synthetic source unavailable');
            const items=Array.from({length:${syntheticCount}},(_,index)=>{const original=source[index%source.length];const id='__plane_'+index;return {...original,id,appid:id,appId:id,appName:id,namespace:id,allIds:{},title:String(original.title||original.name||'Game')+' '+index};});
            _vsInit(items); return items.length;
        })()` });
        await sleep(500);
    }
    await client.send('Runtime.evaluate', { expression:`(() => {
        const scroller=_vs.scroller||document.getElementById('mainContentArea');
        const state={startedAt:performance.now(),frames:[],scrollEvents:[],visualLatencies:[],catchUps:[],lastFrame:null,lastTop:scroller.scrollTop,lastScrollIndex:0,maxMounted:0};
        const onScroll=()=>state.scrollEvents.push({at:performance.now(),top:scroller.scrollTop});
        scroller.addEventListener('scroll',onScroll,{passive:true});
        const frame=timestamp=>{
            const presentedAt=performance.now();
            const top=scroller.scrollTop; const interval=state.lastFrame===null?0:timestamp-state.lastFrame; const delta=top-state.lastTop;
            if(state.lastFrame!==null){
                state.frames.push({at:timestamp,interval,delta,top});
                if(delta!==0){
                    const pending=state.scrollEvents.slice(state.lastScrollIndex);
                    const latest=pending.at(-1); if(latest) state.visualLatencies.push(Math.max(0,presentedAt-latest.at));
                    state.lastScrollIndex=state.scrollEvents.length;
                    if(interval>20&&Math.abs(delta)>Math.max(180,scroller.clientHeight*.25)) state.catchUps.push({at:timestamp,interval,delta,top});
                }
            }
            state.maxMounted=Math.max(state.maxMounted,document.querySelectorAll('#allGamesGrid .game-card').length);
            state.lastFrame=timestamp;state.lastTop=top;
            if(performance.now()-state.startedAt<${durationMs+1500})state.raf=requestAnimationFrame(frame);
        };
        state.stop=()=>{cancelAnimationFrame(state.raf);scroller.removeEventListener('scroll',onScroll);};
        window.__planeScrollAcceptance=state;requestAnimationFrame(frame);return {top:scroller.scrollTop,height:scroller.scrollHeight,clientHeight:scroller.clientHeight};
    })()`, returnByValue:true });

    const bounds = await client.send('Runtime.evaluate', { expression:`(() => {const r=(_vs.scroller||document.getElementById('mainContentArea')).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`, returnByValue:true });
    const { x, y } = bounds.result.value;
    const started = performance.now(); let inputs = 0;
    while (performance.now() - started < durationMs) {
        const elapsed = performance.now() - started;
        const direction = Math.floor(elapsed / phaseMs) % 2 === 0 ? 1 : -1;
        await client.send('Input.dispatchMouseEvent', { type:'mouseWheel', x, y, deltaX:0, deltaY:deltaY*direction });
        inputs++;
        const remaining = eventIntervalMs - ((performance.now() - started) % eventIntervalMs);
        await sleep(Math.max(0, Math.min(eventIntervalMs, remaining)));
    }
    await sleep(500);
    const response=await client.send('Runtime.evaluate',{expression:`(() => {
        const s=window.__planeScrollAcceptance;s.stop();
        const metric=values=>{const a=values.filter(Number.isFinite).sort((x,y)=>x-y);const p=q=>a[Math.min(a.length-1,Math.max(0,Math.ceil(a.length*q)-1))]||0;return {count:a.length,p50:p(.5),p90:p(.9),p95:p(.95),p99:p(.99),max:p(1)};};
        const intervals=s.frames.map(f=>f.interval);const moving=s.frames.filter(f=>f.delta!==0);const absDeltas=moving.map(f=>Math.abs(f.delta));
        return {itemCount:_vs.items.length,durationMs:performance.now()-s.startedAt,viewport:{width:innerWidth,height:innerHeight,scrollerHeight:_vs.scroller.clientHeight,cols:_vs.cols,rowH:_vs.rowH},frames:metric(intervals),effectiveFps:intervals.length/((${durationMs})/1000),thresholds:Object.fromEntries([6.94,8.33,11.11,16.67,20,33.33,50].map(v=>[v,intervals.filter(x=>x>v).length])),movingFrames:moving.length,scrollDelta:metric(absDeltas),scrollEvents:s.scrollEvents.length,inputToPresent:metric(s.visualLatencies),catchUpJumpCount:s.catchUps.length,largestCatchUpDeltaPx:Math.max(0,...s.catchUps.map(x=>Math.abs(x.delta))),longestVisualFreezeMs:Math.max(0,...s.catchUps.map(x=>x.interval)),catchUpSamples:s.catchUps.slice(0,30),maxMounted:s.maxMounted,wrongCoverCount:[...document.querySelectorAll('#allGamesGrid .game-card')].filter(card=>{const game=card._vsBoundGame;const wanted=game?String(_agResolveCardCoverPayload(game)?.cover||''):'';const actual=card.querySelector('.native-lazy-load')?.getAttribute('src')||'';return !!(actual&&wanted&&actual!==wanted);}).length,retainedCards:_vs.retainedCards.size,retainedBytes:_vs.retainedCardBytes,lru:{..._vs.retainedCardStats}};
    })()`,returnByValue:true});
    const result={marker:'PLANE_SCROLL_ACCEPTANCE',measuredAt:new Date().toISOString(),input:{events:inputs,eventIntervalMs,deltaY,phaseMs},syntheticCount,...response.result.value};
    fs.writeFileSync(out,JSON.stringify(result,null,2));console.log(JSON.stringify(result));client.close();
})().catch(error=>{console.error(error.stack||error);process.exit(1);});
