# Large Web AI Model File Proxy Cacher

Retrieve large (GBs) Web AI binary model files from the cloud to cache locally as sharded blobs to then load faster on 2nd page load. Returns stored file as a data URL to use as if you were sending a URL to the orignal function that needed to load the URL in the first place.

## Usage

```js
import FileProxyCache from 'https://cdn.jsdelivr.net/gh/jasonmayes/web-ai-model-proxy-cache@main/FileProxyCache.min.js';

// An function to call with progress updates.
function fileProgressCallback(textUpdate) {
  YourHTMLElement.innerText = textUpdate;
}

// OPTIONAL settings to configure:
/**
FileProxyCache.setCacheName('MyCompanyName');   // Set custom cache name to use for storage.
FileProxyCache.setShardSize(134217728);         // Specify max size in Bytes of each shard in cache.
FileProxyCache.enableDebug(true);               // Enable more vebose logging for status.
**/

// Now use the library in an async function to fetch a file and cache it.
// The 2nd time you call this with the same file URL it will load from local cache instead!
async function loadSomeFile(fileName, callback) {
  let dataUrl = await FileProxyCache.loadFromURL(fileName, callback);

  // Now you can use dataUrl with whatever other function needed file URL,
  // even if itself doesnt support caching files!
  someOtherClass.loadFromURL(dataUrl);
}

// Kick off the loading process with the file you want and monitor file progress
// using callback function to update DOM with % downloaded.
loadSomeFile('https//path/to/your/file.bin', fileProgressCallback);
```

## Questions / Contact

I will be adding to this over time but if you have any questions / feedback then you can find me over on LinkedIn or Twitter:

* [https://www.linkedin.com/in/webai/](https://www.linkedin.com/in/webai/)
* [https://x.com/jason_mayes](https://x.com/jason_mayes)
