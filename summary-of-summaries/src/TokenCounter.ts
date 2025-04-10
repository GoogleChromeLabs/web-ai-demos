/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const AVERAGE_CHARS_PER_TOKEN = 4;
/*
 * TokenCounter is a hybrid implementation of token counting that uses the Prompt API to precisely
 * count the number of tokens on a given input when available or estimates the token count by
 * dividing the length of the input by `AVERAGE_CHARS_PER_TOKEN`.
 */
export default class TokenCounter {
    private constructor(private languageModel?: any) {
    }

    /*
     * Returns the real or estimated number of tokens in the given input.
     */
    async countTokens(input: string): Promise<number> {
        if (this.languageModel) {
            return await this.languageModel.measureInputUsage(input);
        } else {
            return input.length / AVERAGE_CHARS_PER_TOKEN;
        }
    }

    /*
     * Returns data
     */
    isEstimated(): boolean {
        return this.languageModel === undefined;
    }

    /*
     * Async method to create a new instance of the TokenCounter. This method will create a
     * Prompt API backend TokenCounter when the API is available or fall back to using an
     * estimated token count when not.
     */
    static async create(): Promise<TokenCounter> {
        if (self.LanguageModel) {
            const availability = await self.LanguageModel.availability();
            if (availability !== 'unavailable') {
                const languageModel = await self.LanguageModel.create();
                return new TokenCounter(languageModel);
            }
        }
        return new TokenCounter();
    }
}
