/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * URL schemes that are safe to keep in `href` and `src`. The Sanitizer API's
 * default configuration removes unsafe *elements and attributes*, but it
 * deliberately doesn't filter URL schemes, so `[x](javascript:alert(1))` would
 * survive. This closes that gap.
 */
const SAFE_URL_SCHEMES = new Set([
  'http:',
  'https:',
  'mailto:',
  'tel:',
  'sms:',
  'ftp:',
]);

const SAFE_DATA_URL = /^data:image\/(?:png|jpeg|gif|webp|avif)[;,]/i;

export function isSafeUrl(value) {
  const trimmed = value.trim();
  // Empty, fragment-only, and root/query-relative URLs can't carry a scheme.
  if (trimmed === '' || /^[#/?]/.test(trimmed)) {
    return true;
  }
  let url;
  try {
    url = new URL(trimmed, document.baseURI);
  } catch {
    return false;
  }
  if (SAFE_URL_SCHEMES.has(url.protocol)) {
    return true;
  }
  return url.protocol === 'data:' && SAFE_DATA_URL.test(trimmed);
}
