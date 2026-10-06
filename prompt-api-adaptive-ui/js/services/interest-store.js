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

export class InterestStore {
    constructor() {
        this.userInterests = [];
        this.customInterests = [];
        this.removedCategories = new Set();
        this.lastHighlightTargets = [];
    }

    hasInterests() {
        return this.userInterests.length > 0;
    }

    recordInterest(value) {
        this.userInterests.push(value);
    }

    getSplitInterests() {
        return {
            tabClicks: this.userInterests.filter(i => i.startsWith('Interested in ')),
            otherInterests: this.userInterests.filter(i => !i.startsWith('Interested in '))
        };
    }

    resolveCategory(term, product, fallbackCategory = 'Custom') {
        const lowerTerm = term.toLowerCase();

        if (product && product.specs) {
            for (const [cat, specs] of Object.entries(product.specs)) {
                for (const [specKey, specVal] of Object.entries(specs)) {
                    if (
                        specKey.toLowerCase().includes(lowerTerm) ||
                        specVal.toLowerCase().includes(lowerTerm)
                    ) {
                        return cat;
                    }
                }
            }
        }

        return fallbackCategory;
    }

    setAIHighlightTargets(targets, currentProduct) {
        // Store highlight targets and clear previous removed categories state
        this.lastHighlightTargets = [...targets];
        this.removedCategories.clear();

        // Scan the new product specs and reviews for any persisted custom interest keywords
        this.customInterests.forEach(term => {
            const resolvedCategory = this.resolveCategory(term, currentProduct, 'Custom');

            const exists = this.lastHighlightTargets.some(
                t => t.text_snippet.toLowerCase() === term.toLowerCase()
            );
            if (!exists) {
                this.lastHighlightTargets.push({
                    text_snippet: term,
                    relevance_score: 1.0,
                    category: resolvedCategory
                });
            }
        });
    }

    removeCategory(category) {
        this.removedCategories.add(category);

        const beforeCount = this.userInterests.length;
        this.userInterests = this.userInterests.filter(interest => {
            const term = category.toLowerCase();
            return !interest.toLowerCase().includes(term);
        });

        return {
            beforeCount,
            afterCount: this.userInterests.length
        };
    }

    removeSignalTarget(snippet) {
        const beforeCount = this.lastHighlightTargets.length;
        this.lastHighlightTargets = this.lastHighlightTargets.filter(t => t.text_snippet !== snippet);

        // Clean up from persisted custom interests
        this.customInterests = this.customInterests.filter(
            term => term.toLowerCase() !== snippet.toLowerCase()
        );

        // Clean up from tracker history
        this.userInterests = this.userInterests.filter(
            term => term.toLowerCase() !== snippet.toLowerCase()
        );

        return {
            beforeCount,
            afterCount: this.lastHighlightTargets.length
        };
    }

    addCustomInterest(keyword, currentProduct, activeTabCategory) {
        const term = keyword.trim();
        if (!term) return { added: false };

        // Persist custom interest
        if (!this.customInterests.includes(term)) {
            this.customInterests.push(term);
        }

        // Push to behavior tracker to train the model context
        if (!this.userInterests.includes(term)) {
            this.userInterests.push(term);
        }

        // 1. Resolve category based on product specs matching, with fallback to active tab
        const resolvedCategory = this.resolveCategory(
            term,
            currentProduct,
            activeTabCategory || 'Custom'
        );

        // Make sure this category is no longer listed as "removed"
        this.removedCategories.delete(resolvedCategory);

        // 2. Add custom target to active personalization rules
        const newTarget = {
            text_snippet: term,
            relevance_score: 1.0,
            category: resolvedCategory
        };

        // Check if already exists
        const exists = this.lastHighlightTargets.some(
            t => t.text_snippet.toLowerCase() === term.toLowerCase()
        );

        if (!exists) {
            this.lastHighlightTargets.push(newTarget);
            return { added: true, term, resolvedCategory };
        }

        return { added: false, alreadyExists: true, term, resolvedCategory };
    }

    getActiveTargets() {
        return this.lastHighlightTargets.filter(
            t => t.relevance_score > 0.7 && !this.removedCategories.has(t.category)
        );
    }

    getActiveCategories() {
        return [...new Set(this.getActiveTargets().map(t => t.category))];
    }
}
