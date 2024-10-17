/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export default class Ollama {
    constructor(private host: string, private model: string) {}

   /*
    * Example prompt using `curl`:
    *
    * ```shell
    * curl -v http://localhost:11434/api/generate -d '{
    *  "model": "gemma2:2b",
    *  "prompt":"Why is the sky blue?",
    *  "stream": false,
    *  "system": "Talk like a pirate"
    *  }'
    * ```
    */
    async prompt(userPrompt: string, systemPrompt: string | null = null): Promise<string> {
        const body = JSON.stringify({
            model: this.model,
            prompt: userPrompt,
            stream: false,
            system: systemPrompt
        });
        let response = await fetch(`${this.host}/api/generate`, {
            method: 'POST',
            body: body
        });
        const responseBody = await response.json();
        return responseBody.response;
    }
}

