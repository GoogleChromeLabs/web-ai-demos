/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/********************************************************************* 
 * File Proxy Cache Utility Library by Jason Mayes 2025.
 * Version 1.0.4
 *
 * This was primarily made for caching large (GBs) Web AI Model files.
 * However it can likely be used for other binary files too.
 * For docs see https://github.com/jasonmayes/web-ai-model-proxy-cache
 *--------------------------------------------------------------------
 * Connect with me on social if any questions or comments:
 *
 * LinkedIn: https://www.linkedin.com/in/webai/
 * Twitter / X: https://x.com/jason_mayes
 * Github: https://github.com/jasonmayes
 * CodePen: https://codepen.io/jasonmayes
 *********************************************************************/
async function FetchInChunks(t,e={}){const{chunkSize:n=5242880,maxParallelRequests:a=6,progressCallback:r=null,signal:c=null}=e;async function o(t,e,n,a){const r=await fetch(t,{headers:{Range:`bytes=${e}-${n}`},signal:a});if(!r.ok&&206!==r.status)throw new Error("Failed to fetch chunk");return await r.arrayBuffer()}const i=await async function(t,e){const n=await fetch(t,{method:"HEAD",signal:e});if(!n.ok)throw new Error("Failed to fetch the file size");const a=n.headers.get("content-length");if(!a)throw new Error("Content-Length header is missing");return parseInt(a,10)}(t,c),s=await async function(t,e,n,a,r,c){let i=[],s=[],l=0;return await async function(){let h=0;for(;h<e;){if(s.length<a){let a=Math.min(h+n-1,e-1),u=h,w=o(t,h,a,c).then((t=>{i.push({start:u,chunk:t}),l+=t.byteLength,r&&r(l,e),s=s.filter((t=>t!==w))})).catch((t=>{throw t}));s.push(w),h+=n}s.length>=a&&await Promise.race(s)}await Promise.all(s)}(),i.sort(((t,e)=>t.start-e.start)).map((t=>t.chunk))}(t,i,n,a,r,c);return new Blob(s)}let FileProxyCache=function(){let t=134217728,e="JMWebAIModels",n=!1;async function a(t){const e=(new TextEncoder).encode(t),n=await window.crypto.subtle.digest("SHA-256",e);return Array.from(new Uint8Array(n)).map((t=>t.toString(16).padStart(2,"0"))).join("")}async function r(r,c){let o;try{return o=c?await FetchInChunks(r,{chunkSize:5242880,maxParallelRequests:10,progressCallback:(t,e)=>c("Loading file: "+Math.round(t/e*100)+"%")}):await FetchInChunks(r,{chunkSize:5242880,maxParallelRequests:10}),n&&console.log("Caching: "+r),async function(r,c){try{const o=await caches.open(e);let i=0;for(let e=0;e<r.size;e+=t){let n;n=e+t>r.size?r.slice(e,r.size,"binary/octet-stream"):r.slice(e,e+t,"binary/octet-stream"),await o.put(await a(c)+"-"+i,new Response(n)),i++}return await o.put(await a(c),new Response(i)),n&&console.log("Cached: "+c),URL.createObjectURL(r)}catch(t){return console.error(t.name,t.message),URL.createObjectURL(r)}}(o,r)}catch(t){return console.warn("File does not exist! Returning null object."),null}}return{loadFromURL:async function(t,c){n&&console.log("Attempting to fetch: "+t+" from cache.");try{const n=await caches.open(e),o=await a(t),i=await n.match(o);let s=[];if(i){const e=await i.blob();let a=parseInt(await e.text());if(0===a)return await r(t,c);{for(let t=0;t<a;t++){const e=await n.match(o+"-"+t);s.push(await e.blob())}let t=new Blob(s,{type:"binary/octet-stream"});return URL.createObjectURL(t)}}return console.warn("Requested file not in cache - attempting to fetch and then cache."),await r(t,c)}catch(t){console.error(t)}},setCacheName:function(t){e=t},setShardSize:function(e){t=e},enableDebug:function(t){n=t}}}();export default FileProxyCache;
