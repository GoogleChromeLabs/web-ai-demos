/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ReadableStream } from "stream/web";

export default class BuiltinPrompting {
    constructor(private session: AITextSession) {}

    async streamingPrompt(prompt: string): Promise<ReadableStream<string>> {
        return this.session.promptStreaming(prompt);
    }
    
    async prompt(prompt: string): Promise<string> {
        return this.session.prompt(prompt);
    }

    static async createPrompting(): Promise<BuiltinPrompting> {
        if (window.ai && await window.ai.canCreateTextSession() === 'readily') {
            let builtInsession = await window.ai.createTextSession();
            return new BuiltinPrompting(builtInsession);
        } else {
            throw new Error("Built-in prompting not supported");
        }
    }
}
