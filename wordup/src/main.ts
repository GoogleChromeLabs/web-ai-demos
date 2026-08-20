/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'
import { registerSW } from 'virtual:pwa-register'

registerSW({ immediate: true })

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app
