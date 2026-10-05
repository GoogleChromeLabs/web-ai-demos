/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

export class Logger {
    constructor(containerId = 'log-container') {
        this.container = document.getElementById(containerId);
    }

    appendLog(text, type, modifierClass = '') {
        if (!this.container) return;
        const el = document.createElement('div');
        el.className = `log-entry ${type} ${modifierClass}`.trim();
        el.textContent = `[${type.toUpperCase()}]: ${text}`;
        this.container.appendChild(el);
        this.container.scrollTop = this.container.scrollHeight;
    }

    showLoading(message) {
        if (!this.container) return () => {};
        const loadingEl = document.createElement('div');
        loadingEl.className = 'log-entry system loading';
        loadingEl.textContent = message;
        this.container.appendChild(loadingEl);
        this.container.scrollTop = this.container.scrollHeight;
        return () => loadingEl.remove();
    }

    clearLogs() {
        if (this.container) {
            this.container.innerHTML = '';
        }
    }
}
