/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/********************************************************************* 
 * File Proxy Cache Utility Library by Jason Mayes 2025.
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

import FetchInChunks from '/FetchInChunks.js';

let FileProxyCache = function () {
  // Default shard size is 128MB.
  let cacheShardSize = 134217728; // Bytes.
  let cacheName = 'JMWebAIModels';
  let cacheDebug = false;


  function setCacheName(name) {
    cacheName = name;
  }


  function setShardSize(bytes) {
    cacheShardSize = bytes;
  }


  function enableDebug(bool) {
    cacheDebug = bool;
  }


  async function hash(message) {
    const msgUint8 = new TextEncoder().encode(message); // encode as (utf-8) Uint8Array
    const hashBuffer = await window.crypto.subtle.digest("SHA-256", msgUint8); // hash the message
    const hashArray = Array.from(new Uint8Array(hashBuffer)); // convert buffer to byte array
    const hashHex = hashArray
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(""); // convert bytes to hex string
    return hashHex;
  }

  
  async function cacheIt(blob, fileUrl) {
    try {
      const MODEL_CACHE = await caches.open(cacheName);
      let n = 0;
      for (let i = 0; i < blob.size; i+= cacheShardSize) {
        let blobShard = undefined;
        // Ensure not last chunk which may be less than shard size.
        if (i + cacheShardSize > blob.size) {
          blobShard = blob.slice(i, blob.size, 'binary/octet-stream');
        } else {
          blobShard = blob.slice(i, i + cacheShardSize, 'binary/octet-stream');
        }
        await MODEL_CACHE.put(await hash(fileUrl) + '-' + n, new Response(blobShard));
        n++;
      }
      await MODEL_CACHE.put(await hash(fileUrl), new Response(n));
      if (cacheDebug) {
        console.log('Cached: ' + fileUrl);
      }
      return URL.createObjectURL(blob);
    } catch (err) {
      console.error(err.name, err.message);
      return URL.createObjectURL(blob);
    }
  }
  
  
  async function fetchAndCacheFile(url, progressCallback) {
    let blob = undefined;
    try {
      if (progressCallback) {
        blob = await FetchInChunks(url, {
          chunkSize: 5 * 1024 * 1024,
          maxParallelRequests: 10,
          progressCallback: (done, total) => (progressCallback('Loading file: ' + Math.round((done / total) * 100) + '%'))
        });
      } else {
        blob = await FetchInChunks(url, {
          chunkSize: 5 * 1024 * 1024,
          maxParallelRequests: 10
        });
      }
      if (cacheDebug) {
        console.log('Caching: ' + url);
      }
      return cacheIt(blob, url);
    } catch(e) {
      // File not availble return null;
      console.warn('File does not exist! Returning null object.');
      return null;
    }
  };
  
  
  async function fetchFile(url, progressCallback) {
    if (cacheDebug) {
      console.log('Attempting to fetch: ' + url + ' from cache.');
    }
    try {
      const MODEL_CACHE = await caches.open(cacheName);
      const FILE_HASH = await hash(url);
      const response = await MODEL_CACHE.match(FILE_HASH);
      let blobParts = [];
      
      if (!response) {
        console.warn('Requested file not in cache - attempting to fetch and then cache.');
        return await fetchAndCacheFile(url, progressCallback);
      } else {
        const file = await response.blob();
        let n = parseInt(await file.text());
        if (n === 0) {
          return await fetchAndCacheFile(url, progressCallback);
        } else {
          for (let i = 0; i < n; i++) {
            const part = await MODEL_CACHE.match(FILE_HASH + '-' + i);
            blobParts.push(await part.blob());
          }
          
          let concatBlob = new Blob(blobParts, {type: 'binary/octet-stream'});
          return URL.createObjectURL(concatBlob);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };
  return {
    loadFromURL: fetchFile,
    setCacheName: setCacheName,
    setShardSize: setShardSize,
    enableDebug: enableDebug
  };
}();

export default FileProxyCache;
