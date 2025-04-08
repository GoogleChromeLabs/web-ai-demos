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
}

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
        return (window.ai !== undefined && window.ai.languageModel !== undefined) || window.LanguageModel !== undefined;
    }

    static async createPrompting(): Promise<BuiltinPrompting> {
        // The newer version of the API, currently in Chrome Canary, uses `window.LanguageModel`,
        // while the version currently on stable uses window.ai.languageModel. So we this code
        // handles the two paths. This method also expects `isBuiltinAiSupported()` to have been
        // called first.
        if (window.LanguageModel && (await window.LanguageModel.availability()) === 'available') {
            let session = await window.LanguageModel.create();
            return new BuiltinPrompting(session);
        } else if (window.ai.languageModel && (await window.ai.languageModel.capabilities()).available === 'readily') {
            let session = await window.ai.languageModel.create();
            return new BuiltinPrompting(session);
        } else {
            throw new Error("Built-in prompting not supported");
        }
    }
}

