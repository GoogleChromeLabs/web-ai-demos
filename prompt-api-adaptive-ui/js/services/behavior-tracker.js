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

// --- 2. Tracking Engine ---
export class BehaviorTracker {
    constructor({ interestStore, logger }) {
        this.interestStore = interestStore;
        this.logger = logger;
        this.hoverTimers = new Map();
        this.initSelectionListener();
    }

    get userInterests() {
        return this.interestStore.userInterests;
    }

    initSelectionListener() {
        document.addEventListener('mouseup', (event) => {
            const selectedText = window.getSelection().toString().trim();
            if (selectedText.length > 3) {
                // Check if selection is within specs or reviews
                const isWithinSpecs = event.target.closest('.spec-row');
                const isWithinReviews = event.target.closest('.review-card');
                
                if (isWithinSpecs || isWithinReviews) {
                    this.logEvent('Selection', selectedText);
                    this.interestStore.recordInterest(selectedText);
                }
            }
        });
    }

    initHoverListeners() {
        const elements = document.querySelectorAll('.spec-row, .review-card');
        this.logEvent('Debug', `Found ${elements.length} elements for hover listeners`);
        elements.forEach(el => {
            el.addEventListener('mouseenter', () => {
                const value = el.dataset.specValue || el.textContent.trim();
                const timer = setTimeout(() => {
                    this.logEvent('Hover', value);
                    this.interestStore.recordInterest(value);
                }, 1000); // 1 second threshold for hover
                this.hoverTimers.set(el, timer);
            });
            
            el.addEventListener('mouseleave', () => {
                if (this.hoverTimers.has(el)) {
                    clearTimeout(this.hoverTimers.get(el));
                    this.hoverTimers.delete(el);
                }
            });
        });
    }

    trackTabClick(category) {
        this.logEvent('TabClick', category);
        this.interestStore.recordInterest(`Interested in ${category}`);
    }

    logEvent(type, value) {
        // CRITICAL: User requirement to use specific log format
        console.log(`Event: ${type}, Value: ${value}`);
        this.logger.appendLog(`Event: ${type}, Value: "${value}"`, 'tracker');
    }
}
