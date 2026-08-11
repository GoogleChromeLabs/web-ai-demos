/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** Byte-count payload passed to {@link FetchBlobOptions.onProgress}. */
export interface ProgressInfo {
  /** Bytes received so far. */
  loaded: number;
  /**
   * Total expected bytes, or `null` when the server did not send
   * `Content-Length`.
   */
  total: number | null;
}

/** Options accepted by {@link fetchBlob}. */
export interface FetchBlobOptions {
  /**
   * Lowercase hex SHA-256 of the resource, if already known. Takes precedence
   * over {@link getSHA256}.
   */
  sha256?: string;

  /**
   * Returns the lowercase hex SHA-256 for the resource at `url`, or
   * `undefined` if it cannot be determined. Only called when {@link sha256} is
   * not provided.
   *
   * Resolved hashes are cached — in memory for the current session and
   * persistently in the Cache API — so the resolver is only called on the
   * first request for a given URL per origin.
   *
   * When the resolver returns `undefined` or throws, COS cannot be keyed for
   * that URL and {@link fetchBlob} falls back to the Cache API path.
   *
   * Defaults to {@link getHuggingFaceSHA256}.
   */
  getSHA256?: (url: string) => Promise<string | undefined>;

  /**
   * Called with running byte counts whenever a network fetch is in progress.
   * Not called when the resource is served from COS or the Cache API.
   */
  onProgress?: (progress: ProgressInfo) => void;

  /**
   * Cache API bucket name used by the fallback path (when Cross-Origin
   * Storage is unavailable or the user denied the permission prompt).
   *
   * @default 'cos-resource-fetcher'
   */
  cacheName?: string;
}

/**
 * Extracts the SHA-256 hash for a Hugging Face resource by fetching its Git
 * LFS pointer file. Works with any Hugging Face `/resolve/` URL.
 *
 * Resolves to `undefined` when no pointer applies: the URL is not a Hugging
 * Face `/resolve/` URL, or the resource is not LFS-backed (small files such as
 * `config.json` are served verbatim by `/raw/`, with no pointer to parse).
 *
 * @param resolveUrl - A Hugging Face `/resolve/` URL.
 * @returns Lowercase hex SHA-256 string, or `undefined` if the resource has no
 *   LFS pointer.
 */
export declare function getHuggingFaceSHA256(
  resolveUrl: string
): Promise<string | undefined>;

/**
 * Fetches a resource as a `Blob` using Cross-Origin Storage (COS) when
 * available, with the Cache API as an automatic fallback.
 *
 * On the first call the file is downloaded and stored. Subsequent calls from
 * the **same origin** skip both the hash lookup and the download entirely.
 * Subsequent calls from a **different origin** still need one small network
 * request to resolve the SHA-256 (the hash cache is per-origin), but the file
 * itself is served from COS without re-downloading.
 *
 * @param url - Resource URL (e.g. a Hugging Face `/resolve/` URL).
 * @param options - Optional configuration.
 * @returns The resource as a `Blob`.
 */
export declare function fetchBlob(
  url: string,
  options?: FetchBlobOptions
): Promise<Blob>;
