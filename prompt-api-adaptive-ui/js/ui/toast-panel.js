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

export class ToastPanel {
    constructor({ onRemoveCategory, onRemoveSignalTarget, onAddCustomInterest }) {
        this.onRemoveCategory = onRemoveCategory;
        this.onRemoveSignalTarget = onRemoveSignalTarget;
        this.onAddCustomInterest = onAddCustomInterest;
        this.isTunePanelExpanded = false;
        this.lastRenderState = { activeCategories: [], activeTargets: [] };
    }

    render({ activeCategories, activeTargets }) {
        this.lastRenderState = { activeCategories, activeTargets };

        let toast = document.querySelector('.toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.className = 'toast';
            document.body.appendChild(toast);
        }

        // Retain expanded state class
        if (this.isTunePanelExpanded) {
            toast.classList.add('expanded');
        } else {
            toast.classList.remove('expanded');
        }

        toast.innerHTML = '';

        // --- Header Area ---
        const headerDiv = document.createElement('div');
        headerDiv.className = 'toast-header';

        const titleSpan = document.createElement('span');
        titleSpan.className = 'toast-title';
        titleSpan.innerHTML = '<mark>Highlighting</mark> what matters to you:';
        headerDiv.appendChild(titleSpan);

        toast.appendChild(headerDiv);

        // --- Badges Container ---
        const badgeContainer = document.createElement('div');
        badgeContainer.className = 'badge-container';

        if (activeCategories.length === 0) {
            const emptyMsg = document.createElement('span');
            emptyMsg.style.fontSize = '0.72rem';
            emptyMsg.style.color = 'var(--text-muted)';
            emptyMsg.style.fontStyle = 'italic';
            emptyMsg.style.padding = '0.2rem 0';
            emptyMsg.textContent = 'No active highlights. Start browsing to teach HyperAudio what to highlight for you, or customize manually.';
            badgeContainer.appendChild(emptyMsg);
        } else {
            activeCategories.forEach(cat => {
                const badge = document.createElement('span');
                badge.className = 'interest-badge';
                badge.textContent = cat + ' ';

                const removeBtn = document.createElement('button');
                removeBtn.className = 'interest-badge-remove';
                removeBtn.innerHTML = '&times;';
                removeBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (this.onRemoveCategory) {
                        this.onRemoveCategory(cat);
                    }
                });

                badge.appendChild(removeBtn);
                badgeContainer.appendChild(badge);
            });
        }

        toast.appendChild(badgeContainer);

        // --- Toggle Button ("Customize highlights ▾ / ▴") ---
        const tuneToggle = document.createElement('button');
        tuneToggle.className = 'toast-tune-toggle';
        tuneToggle.innerHTML = this.isTunePanelExpanded ? 'Customize highlights &and;' : 'Customize highlights &or;';
        tuneToggle.addEventListener('click', () => {
            this.isTunePanelExpanded = !this.isTunePanelExpanded;
            this.render(this.lastRenderState);
        });
        toast.appendChild(tuneToggle);

        // --- Tuning Control Panel (Drawer) ---
        const tunePanel = document.createElement('div');
        tunePanel.className = 'toast-tune-panel';

        // 1. Active Personalization Rules (Currently highlighted)
        if (activeTargets.length > 0) {
            const activeSection = document.createElement('div');
            activeSection.className = 'tune-section';
            
            const activeTitle = document.createElement('div');
            activeTitle.className = 'tune-section-title';
            activeTitle.textContent = 'Currently highlighted';
            activeSection.appendChild(activeTitle);

            activeTargets.forEach(target => {
                const item = document.createElement('div');
                item.className = 'tune-item';

                const text = document.createElement('span');
                text.className = 'tune-item-text';
                text.innerHTML = `${target.text_snippet} <span class="tune-item-category">${target.category}</span>`;
                text.title = `${target.text_snippet} (${target.category})`;
                item.appendChild(text);

                const removeBtn = document.createElement('button');
                removeBtn.className = 'tune-item-remove';
                removeBtn.innerHTML = '&times;';
                removeBtn.title = 'Remove Highlight';
                removeBtn.addEventListener('click', () => {
                    if (this.onRemoveSignalTarget) {
                        this.onRemoveSignalTarget(target.text_snippet);
                    }
                });
                item.appendChild(removeBtn);

                activeSection.appendChild(item);
            });

            tunePanel.appendChild(activeSection);
        }

        // 2. Add Custom Interest Signal (Add custom highlight)
        const addSection = document.createElement('div');
        addSection.className = 'tune-section';

        const addTitle = document.createElement('div');
        addTitle.className = 'tune-section-title';
        addTitle.textContent = 'Add custom highlight';
        addSection.appendChild(addTitle);

        const addBox = document.createElement('div');
        addBox.className = 'tune-add-box';

        const addInput = document.createElement('input');
        addInput.type = 'text';
        addInput.className = 'tune-add-input';
        addInput.placeholder = 'Type keyword to highlight...';
        addInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const kw = addInput.value.trim();
                if (kw.length > 0 && this.onAddCustomInterest) {
                    this.onAddCustomInterest(kw);
                }
            }
        });
        addBox.appendChild(addInput);

        const addBtn = document.createElement('button');
        addBtn.className = 'tune-add-btn';
        addBtn.innerHTML = '+';
        addBtn.addEventListener('click', () => {
            const kw = addInput.value.trim();
            if (kw.length > 0 && this.onAddCustomInterest) {
                this.onAddCustomInterest(kw);
            }
        });
        addBox.appendChild(addBtn);

        addSection.appendChild(addBox);
        tunePanel.appendChild(addSection);

        toast.appendChild(tunePanel);

        // Trigger class after DOM insertion to play transition
        setTimeout(() => toast.classList.add('show'), 10);
    }
}
