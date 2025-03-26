/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
export default class BuiltinPrompting {
    constructor(private session: AILanguageModel) {}

    streamingPrompt(prompt: string): AsyncIterable<string> {
        // The below typecasts ReadableStream<string> to AsyncIterable<string> as DefinitelyTyped
        // doesn't add the implementation, due to browser compability issues. See
        // https://github.com/DefinitelyTyped/DefinitelyTyped/discussions/62651 for more details.
        return this.session.promptStreaming(prompt) as any as AsyncIterable<string>;
    }

    prompt(prompt: string): Promise<string> {
        return this.session.prompt(prompt);
    }

    static async createPrompting(): Promise<BuiltinPrompting> {
        if (window.ai && (await window.ai.languageModel.availability()) === 'available') {
            let session = await window.ai.languageModel.create();
            return new BuiltinPrompting(session);
        } else {
            throw new Error("Built-in prompting not supported");
        }
    }
}
