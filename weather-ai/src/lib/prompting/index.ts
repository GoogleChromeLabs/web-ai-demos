/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ReadableStream } from "stream/web";

export default class BuiltinPrompting {
    constructor(private session: AIAssistant) {}

    streamingPrompt(prompt: string): ReadableStream<string> {
        return this.session.promptStreaming(prompt);
    }

    prompt(prompt: string): Promise<string> {
        return this.session.prompt(prompt);
    }

    static async createPrompting(): Promise<BuiltinPrompting> {
        if (window.ai && (await window.ai.assistant.capabilities()).available === 'readily') {
            let builtInsession = await window.ai.assistant.create();
            return new BuiltinPrompting(builtInsession);
        } else {
            throw new Error("Built-in prompting not supported");
        }
    }
}
