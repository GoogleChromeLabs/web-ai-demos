/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Declare LanguageModal and ai as globals, to avoid the TS compiler complaining about unknown
// objects in the global scope.
declare global {
  interface Window {
      LanguageModel: any;
      ai: any;
  }
  // The DOM types of TypeScript 4.9 predate `navigator.userActivation`.
  interface Navigator {
      userActivation: { readonly isActive: boolean };
  }
}

// Shared by `availability()` and `create()`, so both ask about the same session.
const SESSION_OPTIONS = {
    expectedInputs: [{ type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
};

// Resolves once the user has interacted with the page. Chrome only starts a model download with
// user activation, which a tap, click, or key press grants.
const waitForUserActivation = (): Promise<void> =>
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

export default class BuiltinPrompting {
    constructor(private session: any) {}

    streamingPrompt(prompt: string): AsyncIterable<string> {
        // The below typecasts ReadableStream<string> to AsyncIterable<string> as DefinitelyTyped
        // doesn't add the implementation, due to browser compability issues. See
        // https://github.com/DefinitelyTyped/DefinitelyTyped/discussions/62651 for more details.
        return this.session.promptStreaming(prompt) as any as AsyncIterable<string>;
    }

    prompt(prompt: string): Promise<string> {
        return this.session.prompt(prompt);
    }

    static isBuiltinAiSupported(): boolean {
        return window.LanguageModel !== undefined;
    }

    // `onStatus` is called with what to tell the user while the model is being downloaded, and
    // with an empty string once the session is ready.
    static async createPrompting(onStatus?: (status: string) => void): Promise<BuiltinPrompting> {
        // This method also expects `isBuiltinAiSupported()` to have been
        // called first.
        const availability = window.LanguageModel
            ? await window.LanguageModel.availability(SESSION_OPTIONS)
            : 'unavailable';
        if (availability === 'unavailable') {
            throw new Error("Built-in prompting not supported");
        }

        // The weather arrives without the user doing anything, so the page may not have the user
        // activation that a download needs yet.
        const downloadNeeded = availability !== 'available';
        if (downloadNeeded && !navigator.userActivation.isActive) {
            onStatus?.('Click anywhere or press a key to download the AI model.');
            await waitForUserActivation();
        }

        let session = await window.LanguageModel.create({
            ...SESSION_OPTIONS,
            monitor(m: EventTarget) {
                m.addEventListener('downloadprogress', (e) => {
                    if (downloadNeeded) {
                        const loaded = (e as ProgressEvent).loaded;
                        onStatus?.(`Downloading the AI model: ${Math.round(loaded * 100)}%`);
                    }
                });
            },
        });
        onStatus?.('');
        return new BuiltinPrompting(session);
    }
}

