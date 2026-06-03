/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const DEFAULT_CACHE_NAME = 'cos-resource-fetcher';
const SHA256_CACHE_NAME = 'cos-resource-fetcher-sha256';

// Two-level SHA-256 lookup cache: in-memory (session) + Cache API (persistent).
const sha256Memory = new Map();

async function resolveSha256(url, getSHA256) {
  if (sha256Memory.has(url)) return sha256Memory.get(url);

  const cache = await caches.open(SHA256_CACHE_NAME);
  const cached = await cache.match(url);
  if (cached) {
    const hash = await cached.text();
    sha256Memory.set(url, hash);
    return hash;
  }

  const hash = await getSHA256(url);
  sha256Memory.set(url, hash);
  // Fire-and-forget; failure is non-fatal (in-memory copy still valid for this session)
  cache.put(
    url,
    new Response(hash, { headers: { 'Content-Type': 'text/plain' } })
  );
  return hash;
}

/**
 * Extracts the SHA-256 hash for a Hugging Face resource by fetching its Git LFS
 * pointer. The /raw/ endpoint returns the pointer; /resolve/ returns the actual
 * bytes — swapping that path segment is sufficient.
 *
 * @param {string} resolveUrl - A Hugging Face /resolve/ URL
 * @returns {Promise<string>} Lowercase hex SHA-256 string
 */
export async function getHuggingFaceSHA256(resolveUrl) {
  const rawUrl = resolveUrl.replace('/resolve/', '/raw/');
  const res = await fetch(rawUrl);
  if (!res.ok) throw new Error(`LFS pointer fetch failed: ${res.status}`);
  const text = await res.text();
  const match = text.match(/^oid sha256:([0-9a-f]{64})$/m);
  if (!match) throw new Error('SHA-256 not found in LFS pointer');
  return match[1];
}

/**
 * @param {string} url
 * @param {((progress: { loaded: number, total: number | null }) => void) | undefined} onProgress
 * @returns {Promise<Blob>}
 */
async function fetchWithProgress(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Network error: ${res.status}`);

  const total = Number(res.headers.get('Content-Length')) || null;
  let loaded = 0;
  const chunks = [];
  const reader = res.body.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress?.({ loaded, total });
  }

  return new Blob(chunks);
}

/**
 * @param {string} url
 * @param {{ sha256: string, onProgress?: Function }} opts
 * @returns {Promise<Blob>}
 */
async function fetchViaCOS(url, { sha256, onProgress }) {
  const hash = { algorithm: 'SHA-256', value: sha256 };

  try {
    const [handle] = await navigator.crossOriginStorage.requestFileHandles([
      hash,
    ]);
    const file = await handle.getFile();
    return new Blob([file], { type: file.type });
  } catch (err) {
    if (err.name !== 'NotFoundError') throw err;

    // Not yet in COS: download, then store for future use by any origin
    const blob = await fetchWithProgress(url, onProgress);
    try {
      const [handle] = await navigator.crossOriginStorage.requestFileHandles(
        [hash],
        {
          create: true,
          origins: '*',
        }
      );
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
    } catch {
      // Storing failed (quota, permissions…); we already have the blob, continue
    }
    return blob;
  }
}

/**
 * @param {string} url
 * @param {{ onProgress?: Function, cacheName: string }} opts
 * @returns {Promise<Blob>}
 */
async function fetchViaCache(url, { onProgress, cacheName }) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(url);
  if (cached) return cached.blob();

  const blob = await fetchWithProgress(url, onProgress);
  await cache.put(
    url,
    new Response(blob, {
      headers: { 'Content-Type': 'application/octet-stream' },
    })
  );
  return blob;
}

/**
 * Fetches a resource as a Blob using Cross-Origin Storage (COS) when available,
 * with the Cache API as fallback. By default resolves the required SHA-256 via
 * Hugging Face's Git LFS pointer, but a pre-computed hash or a custom resolver
 * can be passed in.
 *
 * @param {string} url - Resource URL (e.g. a Hugging Face /resolve/ URL)
 * @param {object} [options]
 * @param {string} [options.sha256]
 *   Lowercase hex SHA-256 of the resource, if already known. Takes precedence
 *   over `getSHA256`.
 * @param {(url: string) => Promise<string>} [options.getSHA256]
 *   Returns the lowercase hex SHA-256 for the resource at `url`. Only called
 *   when `sha256` is not provided. Defaults to {@link getHuggingFaceSHA256}.
 * @param {(progress: { loaded: number, total: number | null }) => void} [options.onProgress]
 *   Called with running byte counts whenever a network fetch is in progress.
 * @param {string} [options.cacheName]
 *   Cache API bucket name used by the fallback path.
 *   Defaults to `'cos-resource-fetcher'`.
 * @returns {Promise<Blob>}
 */
export async function fetchBlob(url, options = {}) {
  const {
    sha256: directSha256,
    getSHA256 = getHuggingFaceSHA256,
    onProgress,
    cacheName = DEFAULT_CACHE_NAME,
  } = options;

  if ('crossOriginStorage' in navigator) {
    try {
      const sha256 = directSha256 ?? (await resolveSha256(url, getSHA256));
      return await fetchViaCOS(url, { sha256, onProgress });
    } catch (err) {
      if (err.name !== 'NotAllowedError') throw err;
      // COS permission denied by user — fall through to Cache API
    }
  }

  return fetchViaCache(url, { onProgress, cacheName });
}
