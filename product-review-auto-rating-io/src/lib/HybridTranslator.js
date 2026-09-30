/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const FALLBACK_ENDPOINT = 'http://localhost:3000';

// Resolves once the user has interacted with the page. Chrome only starts a model download with
// user activation, which a tap, click, or key press grants.
const waitForUserActivation = () =>
    new Promise((resolve) => {
        const controller = new AbortController();
        const onInteraction = () => {
            if (navigator.userActivation.isActive) {
                controller.abort();
                resolve();
            }
        };
        for (const type of ['keydown', 'mousedown', 'pointerup', 'touchend']) {
            document.addEventListener(type, onInteraction, {
                capture: true,
                signal: controller.signal,
            });
        }
    });

// Encapsulates the translation feature, using the built-in Translator API when available and
// falling back to a server-side implementation when not.
//
// `onStatus` is called with what to tell the user while a translation model is being downloaded,
// and with an empty string once it's ready. `after` is a promise to wait for before creating the
// on-device translator.
export default class HybridTranslator {
    constructor(sourceLanguage, targetLanguage, { onStatus, after } = {}) {
        this.sourceLanguage = sourceLanguage;
        this.targetLanguage = targetLanguage;
        this.onStatus = onStatus;
        // Resolves with the on-device Translator, or with `undefined` when there is none for these
        // languages, in which case translations go to the server.
        this.onDeviceTranslator = Promise.resolve(after)
            .then(() => this.createOnDeviceTranslator())
            .catch((error) => {
                console.error('Failed to create the on-device translator:', error);
                this.onStatus?.('');
            });
    }

    async createOnDeviceTranslator() {
        if (!('Translator' in self)) {
            return undefined;
        }

        // Shared by `availability()` and `create()`, so both ask about the same translator.
        const options = { sourceLanguage: this.sourceLanguage, targetLanguage: this.targetLanguage };
        const availability = await Translator.availability(options);
        if (availability === 'unavailable') {
            return undefined;
        }

        const languages = `${this.sourceLanguage} → ${this.targetLanguage}`;
        const downloadNeeded = availability !== 'available';
        // The translators are created as soon as the chat opens, which may be before the user has
        // interacted with the page.
        if (downloadNeeded && !navigator.userActivation.isActive) {
            this.onStatus?.(`Click anywhere or press a key to download the ${languages} translation model.`);
            await waitForUserActivation();
        }

        const translator = await Translator.create({
            ...options,
            monitor: (m) => {
                m.addEventListener('downloadprogress', (e) => {
                    if (downloadNeeded) {
                        this.onStatus?.(`Downloading the ${languages} translation model: ${Math.round(e.loaded * 100)}%`);
                    }
                });
            },
        });
        this.onStatus?.('');
        return translator;
    }

    // Translates a string between languages. If an on-device Translator is available for the currently set
    // languages, it will be used. Otherwise, the implementation falls back to invoking the translate endpoint.
    async translate(input) {
        if (input.trim().length === 0) {
            return "";
        }

        const translator = await this.onDeviceTranslator;
        if (translator) {
            return translator.translate(input);
        }

        let response = await fetch(`${FALLBACK_ENDPOINT}/translate?text=${input}&from=${this.sourceLanguage}&to=${this.targetLanguage}`)
        return await response.text();
    }
}
