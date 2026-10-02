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

// CRITICAL: JSON Schema defined by user
const HIGHLIGHT_SCHEMA = {
    type: "object",
    properties: {
        highlight_targets: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    text_snippet: { type: "string" },
                    relevance_score: { type: "number" },
                    category: { type: "string" }
                },
                required: ["text_snippet", "relevance_score", "category"]
            }
        }
    },
    required: ["highlight_targets"],
    additionalProperties: false
};

const SYSTEM_PROMPT =
    "You are a shopping assistant. Based on the user's past interactions, identify specific text in the current product's specs or reviews that matches their interests. Return ONLY valid JSON.";

export class AIPersonalizer {
    constructor({ logger }) {
        this.logger = logger;
    }

    async initAI() {
        try {
            // CRITICAL: Check availability using recorded docs syntax
            if (typeof LanguageModel === 'undefined') {
                this.logger.appendLog('LanguageModel API is not supported.', 'system');
                return;
            }
            
            const availability = await LanguageModel.availability();
            this.logger.appendLog(`AI Availability = ${availability}`, 'system');
            
            if (availability === 'unavailable') {
                this.logger.appendLog('Model not available.', 'system');
                return;
            }

            this.logger.appendLog('AI Personalization can be used.', 'system');

        } catch (e) {
            this.logger.appendLog(`Error: ${e.message}`, 'system');
        }
    }

    async findHighlightTargets({ product, tabClicks, otherInterests }) {
        if (typeof LanguageModel === 'undefined') {
            this.logger.appendLog('LanguageModel not found. Check flags!', 'system');
            return null;
        }

        const currentProductText = JSON.stringify({
            name: product.name,
            specs: product.specs,
            reviews: product.reviews
        });

        // CRITICAL: Logging format reqs
        this.logger.appendLog(
            `Tab Clicks: ${JSON.stringify(tabClicks)} | Other: ${JSON.stringify(otherInterests)} | Context: "${product.name} text..."`,
            'ai-input'
        );

        const prompt = `
User Explicit Tab Clicks (Indicating high interest in these categories):
${JSON.stringify(tabClicks)}

Other User Interactions (Dwell time >3s or text selection):
${JSON.stringify(otherInterests)}

Current Product Data:
${currentProductText}

Analyze the Product Data and find text snippets that match the User Interests. Prioritize matches in categories the user clicked on. Break down the matches into specific snippets.
`;

        let session = null;
        try {
            // Create a clean, fresh one-shot session for this run to prevent kErrorUnknown
            session = await LanguageModel.create({
                initialPrompts: [
                    {
                        role: 'system',
                        content: SYSTEM_PROMPT
                    }
                ]
            });

            const response = await session.prompt(prompt, {
                responseConstraint: HIGHLIGHT_SCHEMA // Using responseConstraint as per docs
            });

            // CRITICAL: Logging format reqs
            this.logger.appendLog(`Raw JSON: ${response}`, 'ai-output');

            const result = JSON.parse(response);
            return result.highlight_targets || null;
        } finally {
            if (session) {
                try {
                    session.destroy();
                } catch (err) {
                    console.warn('Failed to destroy session:', err);
                }
            }
        }
    }
}
