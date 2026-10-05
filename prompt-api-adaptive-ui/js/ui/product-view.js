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

// --- 4. UI/UX Highlights & Product Rendering ---
export class ProductView {
    constructor({ containerId = 'product-view', logger, onTabClick, onDomUpdated }) {
        this.view = document.getElementById(containerId);
        this.logger = logger;
        this.onTabClick = onTabClick;
        this.onDomUpdated = onDomUpdated;
        this.initTabDelegation();
    }

    initTabDelegation() {
        if (!this.view) return;

        // Setup event delegation for product specs tabs inside #product-view
        this.view.addEventListener('click', (e) => {
            const btn = e.target.closest('.tab-btn');
            if (!btn) return;
            
            const index = btn.getAttribute('data-index');
            const catName = btn.textContent.trim();
            
            // Update active tab button state
            this.view.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // Update active content specs pane state
            this.view.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
            const targetPane = this.view.querySelector(`.tab-pane[data-pane-index="${index}"]`);
            if (targetPane) {
                targetPane.classList.add('active');
            }
            
            // Track tab click
            if (this.onTabClick) {
                this.onTabClick(catName);
            }
        });
    }

    updateProductSelector(activeId) {
        document.querySelectorAll('.product-selector button').forEach(b => b.classList.remove('active'));
        const activeBtn = document.getElementById(`btn-prod-${activeId}`);
        if (activeBtn) activeBtn.classList.add('active');
    }

    getActiveTabCategory(product) {
        if (!product || !product.specs || !this.view) return null;
        const activeTabBtn = this.view.querySelector('.tab-btn.active');
        if (!activeTabBtn) return null;
        const activeIndex = activeTabBtn.getAttribute('data-index');
        const tabKeys = Object.keys(product.specs);
        return tabKeys[activeIndex] || null;
    }

    renderProduct(product) {
        if (!this.view) return;
        const categories = Object.keys(product.specs);
        
        this.view.innerHTML = `
            <div class="product-layout">
                <div class="product-image-container">
                    <img src="${product.image}" alt="${product.name}" class="product-image">
                </div>
                <div class="product-info">
                    <h2 class="product-title">${product.name}</h2>
                    
                    <div class="tabs-container">
                        ${categories.map((cat, index) => `
                            <button class="tab-btn ${index === 0 ? 'active' : ''}" data-index="${index}">${cat}</button>
                        `).join('')}
                    </div>

                    <div class="tabs-content">
                        ${Object.entries(product.specs).map(([cat, specs], index) => `
                            <div class="tab-pane ${index === 0 ? 'active' : ''}" data-pane-index="${index}">
                                <div class="specs-grid">
                                    ${Object.entries(specs).map(([key, val]) => `
                                        <div class="spec-row" data-spec-value="${val}">
                                            <div class="spec-label">${key}</div>
                                            <div class="spec-value">${val}</div>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        `).join('')}
                    </div>

                    <div class="reviews-section">
                        <h3>Community Reviews</h3>
                        ${product.reviews.map(r => `<div class="review-card">${r}</div>`).join('')}
                    </div>
                </div>
            </div>
        `;

        if (this.onDomUpdated) {
            setTimeout(() => this.onDomUpdated(), 100);
        }
    }

    applyHighlights(activeTargets) {
        const view = document.querySelector('.product-info') || this.view;
        if (!view) return;
        let html = view.innerHTML;

        activeTargets.forEach(target => {
            const snippet = target.text_snippet;
            if (!snippet) return;

            // Simple case-insensitive matching
            const regex = new RegExp(`(${this.escapeRegex(snippet)})`, 'gi');
            
            // Avoid breaking HTML tags by being careful where we replace
            // A robust implementation would use DOM traversal, but for a prototype, 
            // a string replace on specific parts or text nodes is safer.
            // Here we do a simple replace, warning: might break if snippet is inside an attr.
            
            this.logger.appendLog(`UI update: Highlighting "${snippet}" with score ${target.relevance_score}.`, 'system');

            html = html.replace(regex, '<mark>$1</mark>');
        });

        view.innerHTML = html;

        // Update tab highlight indicators
        const panes = view.querySelectorAll('.tab-pane');
        panes.forEach(pane => {
            const index = pane.getAttribute('data-pane-index');
            const hasHighlight = pane.querySelector('mark') !== null;
            const btn = view.querySelector(`.tab-btn[data-index="${index}"]`);
            if (btn) {
                if (hasHighlight) {
                    btn.classList.add('has-highlight');
                } else {
                    btn.classList.remove('has-highlight');
                }
            }
        });

        // Re-attach hover listeners since innerHTML destroyed them
        if (this.onDomUpdated) {
            setTimeout(() => this.onDomUpdated(), 100);
        }
    }

    escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}
