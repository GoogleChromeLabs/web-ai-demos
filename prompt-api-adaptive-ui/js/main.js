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

import { products } from './data/products.js';
import { AIPersonalizer } from './services/ai-personalizer.js';
import { BehaviorTracker } from './services/behavior-tracker.js';
import { InterestStore } from './services/interest-store.js';
import { Logger } from './ui/logger.js';
import { ProductView } from './ui/product-view.js';
import { ToastPanel } from './ui/toast-panel.js';

// --- 3. Application Orchestrator ---
export class App {
    constructor() {
        this.currentProduct = null;
        this.logger = new Logger('log-container');
        this.interestStore = new InterestStore();
        this.tracker = new BehaviorTracker({
            interestStore: this.interestStore,
            logger: this.logger
        });
        this.aiPersonalizer = new AIPersonalizer({
            logger: this.logger
        });
        this.productView = new ProductView({
            containerId: 'product-view',
            logger: this.logger,
            onTabClick: (category) => this.tracker.trackTabClick(category),
            onDomUpdated: () => this.tracker.initHoverListeners()
        });
        this.toastPanel = new ToastPanel({
            onRemoveCategory: (category) => this.removeInterest(category),
            onRemoveSignalTarget: (snippet) => this.removeSignalTarget(snippet),
            onAddCustomInterest: (keyword) => this.addCustomInterest(keyword)
        });

        this.init();
    }

    async init() {
        this.bindControls();
        this.loadProduct(1); // Load Product A by default
        this.aiPersonalizer.initAI();
        this.updateToastUI();
    }

    bindControls() {
        document.querySelectorAll('.product-selector button[data-product-id]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = Number(btn.getAttribute('data-product-id'));
                this.loadProduct(id);
            });
        });

        const clearBtn = document.getElementById('btn-clear-logs');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.clearLogs());
        }
    }

    loadProduct(id) {
        const product = products.find(p => p.id === id);
        if (!product) return;

        // CRITICAL: User requirement to use word "chosen" instead of "sticking with"
        this.logger.appendLog(`User has chosen product: ${product.name}`, 'system');
        this.currentProduct = product;
        this.productView.renderProduct(product);
        this.productView.updateProductSelector(id);

        // Auto-trigger personalization if interests exist
        if (this.interestStore.hasInterests()) {
            this.triggerPersonalization();
        }
    }

    async triggerPersonalization() {
        if (typeof LanguageModel === 'undefined') {
            this.logger.appendLog('LanguageModel not found. Check flags!', 'system');
            return;
        }

        if (!this.interestStore.hasInterests()) {
            this.logger.appendLog('No user interests tracked yet. Click or dwell on features!', 'system');
            return;
        }

        const removeLoading = this.logger.showLoading('✨ AI Personalizing content based on user interests...');
        const { tabClicks, otherInterests } = this.interestStore.getSplitInterests();

        try {
            const highlightTargets = await this.aiPersonalizer.findHighlightTargets({
                product: this.currentProduct,
                tabClicks,
                otherInterests
            });

            if (highlightTargets) {
                this.interestStore.setAIHighlightTargets(highlightTargets, this.currentProduct);
                this.productView.applyHighlights(this.interestStore.getActiveTargets());
                this.updateToastUI();
            }
            this.logger.appendLog('✨ AI Personalization complete.', 'system');
        } catch (e) {
            this.logger.appendLog(`AI Error: ${e.message}`, 'system');
            console.error('AI Error:', e);
        } finally {
            removeLoading();
        }
    }

    updateToastUI() {
        this.toastPanel.render({
            activeCategories: this.interestStore.getActiveCategories(),
            activeTargets: this.interestStore.getActiveTargets()
        });
    }

    removeInterest(category) {
        const { beforeCount, afterCount } = this.interestStore.removeCategory(category);
        this.logger.appendLog(
            `State update: Removed "${category}" from tracking history (Interests: ${beforeCount} -> ${afterCount}).`,
            'system'
        );

        // Re-render current product and apply remaining highlights
        this.productView.renderProduct(this.currentProduct);
        this.productView.applyHighlights(this.interestStore.getActiveTargets());
        this.updateToastUI();
    }

    removeSignalTarget(snippet) {
        const { beforeCount, afterCount } = this.interestStore.removeSignalTarget(snippet);
        this.logger.appendLog(
            `Tuning: Removed signal "${snippet}" from rules list (Rules: ${beforeCount} -> ${afterCount}).`,
            'system'
        );

        // Re-apply highlights with updated rules list
        this.productView.renderProduct(this.currentProduct);
        this.productView.applyHighlights(this.interestStore.getActiveTargets());
        this.updateToastUI();
    }

    addCustomInterest(keyword) {
        const activeTabCategory = this.productView.getActiveTabCategory(this.currentProduct);
        const result = this.interestStore.addCustomInterest(
            keyword,
            this.currentProduct,
            activeTabCategory
        );

        if (!result.added) {
            if (result.alreadyExists) {
                this.logger.appendLog(`Tuning: Signal "${result.term}" already exists in interest graph.`, 'system');
            }
            return;
        }

        this.logger.appendLog(
            `Tuning: Added custom highlight target "${result.term}" in category "${result.resolvedCategory}" with score 1.0.`,
            'system'
        );

        // Re-apply highlights with the new rules
        this.productView.renderProduct(this.currentProduct);
        this.productView.applyHighlights(this.interestStore.getActiveTargets());
        this.updateToastUI();
    }

    clearLogs() {
        this.logger.clearLogs();
    }
}

// Initialize App
const app = new App();
window.app = app;
