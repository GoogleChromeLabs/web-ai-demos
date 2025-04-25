/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 *
 * This utility library is a trimmed down version based on original by tomayac on Github. 
 * Grab latest from: https://github.com/tomayac/fetch-in-chunks
 *
 * @typedef {Object} FetchInChunksOptions
 * @property {number} [chunkSize=5 * 1024 * 1024] - The size of each chunk in
 *   bytes. Default is `5 * 1024 * 1024`
 * @property {number} [maxParallelRequests=6] - The maximum number of parallel
 *   chunk requests. Default is `6`
 * @property {function(number, number): void} [progressCallback=null] - A
 *   callback function that is called with the downloaded bytes and total file
 *   size. Default is `null`
 * @property {AbortSignal} [signal=null] - An AbortSignal to allow aborting the
 *   request. Default is `null`
 */

/**
 * Fetch a file in chunks with parallel requests and optional progress tracking.
 *
 * @param {string} url - The URL of the file to download.
 * @param {FetchInChunksOptions} [options={}] - The options for the download.
 *   Default is `{}`
 * @returns {Promise<Blob>} A promise that resolves to a Blob containing the
 *   downloaded file.
 */
async function FetchInChunks(url, options = {}) {
  const {
    chunkSize = 5 * 1024 * 1024,
    maxParallelRequests = 6,
    progressCallback = null,
    signal = null,
  } = options;

  /**
   * Get the size of the remote file using a HEAD request.
   *
   * @param {string} url - The URL of the file.
   * @param {AbortSignal} signal - The abort signal.
   * @returns {Promise<number>} The size of the file in bytes.
   */
  async function getFileSize(url, signal) {
    const response = await fetch(url, { method: 'HEAD', signal });
    if (!response.ok) {
      throw new Error('Failed to fetch the file size');
    }
    const contentLength = response.headers.get('content-length');
    if (!contentLength) {
      throw new Error('Content-Length header is missing');
    }
    return parseInt(contentLength, 10);
  }

  /**
   * Fetch a chunk of the file.
   *
   * @param {string} url - The URL of the file.
   * @param {number} start - The start byte of the chunk.
   * @param {number} end - The end byte of the chunk.
   * @param {AbortSignal} signal - The abort signal.
   * @returns {Promise<ArrayBuffer>} The chunk data.
   */
  async function fetchChunk(url, start, end, signal) {
    const response = await fetch(url, {
      headers: { Range: `bytes=${start}-${end}` },
      signal,
    });
    if (!response.ok && response.status !== 206) {
      throw new Error('Failed to fetch chunk');
    }
    return await response.arrayBuffer();
  }

  /**
   * Download the file in chunks with parallelism.
   *
   * @param {string} url - The URL of the file.
   * @param {number} fileSize - The size of the file in bytes.
   * @param {number} chunkSize - The size of each chunk in bytes.
   * @param {number} maxParallelRequests - The maximum number of parallel chunk
   *   requests.
   * @param {function(number, number): void} progressCallback - The progress
   *   callback function.
   * @param {AbortSignal} signal - The abort signal.
   * @returns {Promise<ArrayBuffer[]>} The downloaded chunks.
   */
  async function downloadChunks(
    url,
    fileSize,
    chunkSize,
    maxParallelRequests,
    progressCallback,
    signal,
  ) {
    let chunks = [];
    let queue = [];
    let downloadedBytes = 0;

    // Function to process the queue
    async function processQueue() {
      let start = 0;
      while (start < fileSize) {
        if (queue.length < maxParallelRequests) {
          let end = Math.min(start + chunkSize - 1, fileSize - 1);
          // Preserve the actual start value.
          let actualStart = start;
          let promise = fetchChunk(url, start, end, signal)
            .then((chunk) => {
              // Use preserved start value.
              chunks.push({ start: actualStart, chunk });
              downloadedBytes += chunk.byteLength;

              if (progressCallback) {
                progressCallback(downloadedBytes, fileSize);
              }

              queue = queue.filter((p) => p !== promise);
            })
            .catch((err) => {
              throw err;
            });
          queue.push(promise);
          start += chunkSize;
        }
        if (queue.length >= maxParallelRequests) {
          await Promise.race(queue);
        }
      }

      await Promise.all(queue);
    }

    await processQueue();

    return chunks.sort((a, b) => a.start - b.start).map((chunk) => chunk.chunk);
  }

  const fileSize = await getFileSize(url, signal);

  const chunks = await downloadChunks(
    url,
    fileSize,
    chunkSize,
    maxParallelRequests,
    progressCallback,
    signal,
  );

  const blob = new Blob(chunks);

  return blob;
}

export default FetchInChunks;
