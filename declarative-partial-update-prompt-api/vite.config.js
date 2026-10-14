/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { defineConfig } from 'vite';

export default defineConfig({
  // Relative, so the site works from a repository subpath such as
  // /web-ai-demos/declarative-partial-update-prompt-api/ as well as from a
  // domain root.
  base: './',
  build: {
    target: 'esnext',
  },
});
