/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared demo helper: renders a banner explaining whether the current page
 * is forcing the polyfill or using native browser support when available,
 * and sets the polyfill's force flag accordingly.
 *
 * By default (no `?native` URL param) the polyfill is always forced, even
 * if the browser has native support, so the demo reliably exercises the
 * polyfill code path. Add `?native` to the URL to use native support when
 * the browser provides it, falling back to the polyfill only if it doesn't.
 *
 * Intentionally a plain classic script (not an ES module): it must run,
 * and finish, before the `<script type="module">` tag that imports the
 * polyfill, since the polyfill reads the force flag once, at import time.
 * A bundler is free to merge multiple `<script type="module">` tags from
 * one HTML page into a single chunk, where hoisted `import`s all evaluate
 * before any plain statement — including a call meant to run "first" — so
 * that ordering can't be relied on across module scripts once built.
 * Classic scripts aren't part of the module graph, so bundlers leave them
 * (and their relative order versus module scripts) alone; this file lives
 * in `public/` so it's copied as-is instead of being run through the
 * bundler, which refuses to bundle a non-module script anyway.
 */
function setupPolyfillModeBanner({ apiName, forceFlag }) {
  const params = new URLSearchParams(location.search);
  const useNative = params.has('native');
  window[forceFlag] = !useNative;

  const banner = document.getElementById('polyfill-mode-banner');
  if (!banner) {
    return;
  }

  const toggleUrl = new URL(location.href);
  toggleUrl.searchParams.delete('native');
  const toggleQuery = toggleUrl.searchParams.toString();
  const toggleHref =
    toggleUrl.pathname +
    (useNative
      ? toggleQuery
        ? `?${toggleQuery}`
        : ''
      : toggleQuery
        ? `?${toggleQuery}&native`
        : '?native');

  banner.style.cssText =
    'display: block; padding: 0.75rem 1rem; margin-bottom: 1.5rem; ' +
    'border-radius: 6px; border: 1px solid; font-size: 0.9rem;';

  if (useNative) {
    banner.style.background = '#e6f4ea';
    banner.style.borderColor = '#1a7f37';
    banner.style.color = '#1a7f37';
    banner.innerHTML =
      `Mode: <strong>native support if available</strong> — this demo uses ` +
      `<code>window.${apiName}</code> natively when the browser provides ` +
      `it, and only falls back to the polyfill otherwise. ` +
      `<a href="${toggleHref}">Switch to forced-polyfill mode</a>.`;
  } else {
    banner.style.background = '#fff8e1';
    banner.style.borderColor = '#b8860b';
    banner.style.color = '#7a5b00';
    banner.innerHTML =
      `Mode: <strong>polyfill forced</strong> (default) — this demo ` +
      `ignores any native ${apiName} support and always uses the ` +
      `polyfill. <a href="${toggleHref}">Switch to native-support mode</a>.`;
  }
}
