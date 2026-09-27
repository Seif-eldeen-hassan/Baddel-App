#!/usr/bin/env node
'use strict';
const http=require('node:http');
const port=Number(process.argv.find(value=>value.startsWith('--port='))?.slice(7)||9223);
const restore=process.argv.includes('--restore');
const getJson=path=>new Promise((resolve,reject)=>http.get({host:'127.0.0.1',port,path},response=>{let body='';response.on('data',chunk=>body+=chunk);response.on('end',()=>{try{resolve(JSON.parse(body));}catch(error){reject(error);}});}).on('error',reject));
(async()=>{
 const target=(await getJson('/json')).find(item=>item.type==='page'&&/dashboard\.html/.test(item.url));
 if(!target)throw new Error('Dashboard target unavailable');
 const socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
 const expression=restore?`(()=>{if(window.__visibleFirstCoverTrialOriginal){window._vsRequestCoverBind=window.__visibleFirstCoverTrialOriginal;window.__visibleFirstCoverTrialOriginal=null;return {restored:true};}return {restored:false};})()`:`(()=>{
   if(window.__visibleFirstCoverTrialOriginal)return {installed:true,alreadyInstalled:true};
   const original=window._vsRequestCoverBind;
   if(typeof original!=='function')throw new Error('_vsRequestCoverBind unavailable');
   window.__visibleFirstCoverTrialOriginal=original;
   window.__visibleFirstCoverTrialStats={deferredEarlyBufferBinds:0};
   window._vsRequestCoverBind=function(card,game,priority,resolvedPayload){
     if(priority==='buffer'&&window._vs?._isFastScrolling){
       window.__visibleFirstCoverTrialStats.deferredEarlyBufferBinds++;
       if(card)card._vsPendingCoverUrl='';
       return false;
     }
     return original.apply(this,arguments);
   };
   return {installed:true};
 })()`;
 const result=await new Promise((resolve,reject)=>{socket.onmessage=event=>{const message=JSON.parse(event.data);if(message.id!==1)return;message.error?reject(new Error(message.error.message)):resolve(message.result);};socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{returnByValue:true,expression}}));});
 if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
 console.log(JSON.stringify(result.result?.value||result));socket.close();
})().catch(error=>{console.error(error.stack||error);process.exit(1);});
