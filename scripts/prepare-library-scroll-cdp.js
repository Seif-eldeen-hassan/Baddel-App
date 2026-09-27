#!/usr/bin/env node
'use strict';
const http = require('node:http');
const port = Number(process.argv.find(value => value.startsWith('--port='))?.slice(7) || 9223);
const route = process.argv.find(value => value.startsWith('--route='))?.slice(8) || 'all';
const getJson = path => new Promise((resolve,reject)=>http.get({host:'127.0.0.1',port,path},response=>{let body='';response.on('data',chunk=>body+=chunk);response.on('end',()=>{try{resolve(JSON.parse(body));}catch(error){reject(error);}});}).on('error',reject));
(async()=>{
    const target=(await getJson('/json')).find(item=>item.type==='page'&&/dashboard\.html/.test(item.url));
    if(!target) throw new Error('Dashboard target unavailable');
    const socket=new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
    const result=await new Promise((resolve,reject)=>{
        socket.onmessage=event=>{const message=JSON.parse(event.data);if(message.id!==1)return;message.error?reject(new Error(message.error.message)):resolve(message.result);};
        socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{awaitPromise:true,returnByValue:true,expression:`(async()=>{
            const ready=${JSON.stringify(route)}==='ready';
            window.agReadyOnly=ready;
            window.agInstalledOnly=false;
            let all=Array.isArray(window._allGamesCache)&&window._allGamesCache.length?window._allGamesCache:(Array.isArray(window._allGamesRawCache)?window._allGamesRawCache:[]);
            if(!all.length){
                const snapshots=await Promise.all(['steam','epic','gog'].map(platform=>window.electronAPI.platformSyncGetCached?.(platform).catch(()=>({}))));
                const cachedPlatformGames=snapshots.flatMap(snapshot=>Array.isArray(snapshot?.games)?snapshot.games:[]);
                const projection=await buildAllGamesLibraryProjection({cachedPlatformGames,accountMetadata:{steam:[],epic:[],gog:[]}});
                window._allGamesRawCache=projection.rawResolved||[];
                window._allGamesCache=_agGetUserLibraryGames(window._allGamesRawCache);
                const computedReady=_agComputeReadyToInstallGamesFromCache();
                if(computedReady!==null)_agPublishReadyToInstallState(computedReady,'scroll-diagnostic-cache-setup');
                all=window._allGamesCache;
            }
            const canonicalReady=typeof getCanonicalReadyToInstallGames==='function'?getCanonicalReadyToInstallGames():null;
            const games=ready?(Array.isArray(canonicalReady)?canonicalReady:[]):all;
            if(!games.length) return {prepared:false,route:${JSON.stringify(route)},allCount:all.length,canonicalReadyCount:Array.isArray(canonicalReady)?canonicalReady.length:null,reason:'cache-empty'};
            if(typeof _hideAllViews==='function') _hideAllViews();
            const view=document.getElementById('allGamesView'); if(view)view.style.display='block';
            document.body.classList.toggle('ag-ready-mode',ready);
            window._agState={platform:'all',sort:'title_asc',search:'',account:'all'};
            if(!ready){window._allGamesCache=games;} else if(typeof _agProjectReadyArtworkFromAllGames==='function'){_agProjectReadyArtworkFromAllGames(games);}
            _agSetToolbarVisible?.(true);
            _renderAllGamesGrid(games,true,true);
            await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
            return {prepared:true,route:${JSON.stringify(route)},allCount:all.length,canonicalReadyCount:Array.isArray(canonicalReady)?canonicalReady.length:null,itemCount:_vs.items.length,mountedCards:document.querySelectorAll('#allGamesGrid .game-card').length,hidden:document.hidden};
        })()`}}));
    });
    if(result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
    console.log(JSON.stringify(result.result?.value||result));
    socket.close();
})().catch(error=>{console.error(error.stack||error);process.exit(1);});
