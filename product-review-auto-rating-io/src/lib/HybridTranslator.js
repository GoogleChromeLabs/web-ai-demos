/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const FALLBACK_ENDPOINT = 'http://localhost:3000';

// Encapsulates the translation feature, using on-device when available and falling back to a server-side
// implementation when not.
//
// When a source / target language are 
export default class HybridTranslator {
    constructor(sourceLanguage, targetLanguage) {
        this.supportsOnDevice = window.model !== undefined && window.model.createTranslator !== undefined;
        this.onDeviceTranslatorReady = false;
        this.onDeviceTranslator = undefined;
        this.sourceLanguage = sourceLanguage;
        this.targetLanguage = targetLanguage;
        this.tryCreateTranslator();
    }

    // Tries creating a Translator object for the currently set source / target languages. The object
    // will be created asynchronously, and the internal state of the object reflected when ready.
    tryCreateTranslator() {
        if (this.supportsOnDevice) {
            this.onDeviceTranslatorReady = false;
            const parameters = {sourceLanguage: this.sourceLanguage, targetLanguage: this.targetLanguage};
            window.model?.canTranslate(parameters)
                .then(async modelState => {
                    if (modelState == 'no') {
                        return;
                    }

                    this.onDeviceTranslator = await window.model?.createTranslator(parameters)
                    this.onDeviceTranslatorReady = true;
                });
        }
    }

    // Translates a string between languages. If an on-device Translator is available for the currently set
    // languages, it will be used. Otherwise, the implementation falls back to invoking the translate endpoint.
    async translate(input) {
        if (input.trim().length === 0) {
            return "";
        }
        
        if (this.supportsOnDevice && this.onDeviceTranslatorReady) {
            let result = await this.onDeviceTranslator?.translate(input);
            if (!result) {
                throw new Error('Failed to translate')
            }
            return result;
        }

        let response = await fetch(`${FALLBACK_ENDPOINT}/translate?text=${input}&from=${this.sourceLanguage}&to=${this.targetLanguage}`)        
        return await response.text();
    }
}