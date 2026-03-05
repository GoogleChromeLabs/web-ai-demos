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
        return window.LanguageModel !== undefined;
    }

    static async createPrompting(): Promise<BuiltinPrompting> {
        // This method also expects `isBuiltinAiSupported()` to have been
        // called first.
        if (window.LanguageModel && (await window.LanguageModel.availability({
            expectedInputs: [{ type: 'text', languages: ['en'] }],
            expectedOutputs: [{ type: 'text', languages: ['en'] }],
        })) === 'available') {
            let session = await window.LanguageModel.create({
                expectedInputs: [{ type: 'text', languages: ['en'] }],
                expectedOutputs: [{ type: 'text', languages: ['en'] }],
            });
            return new BuiltinPrompting(session);
        } else {
            throw new Error("Built-in prompting not supported");
        }
    }
}

