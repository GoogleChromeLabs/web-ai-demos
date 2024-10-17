/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GenerativeModel, GoogleGenerativeAI, HarmBlockThreshold, HarmCategory, SchemaType } from '@google/generative-ai';

const SYSTEM_PROMPT = `
Analyze the text and generate a comprehensive list of factual and unique statements that can
be inferred from the text. Return the extracted statements in a JSON array, where each item of
the array is one statement. Each statement must be independent and contain all information
needed to understand it.

Example:
INPUT:
Everton's Weir cools Euro hopes

Everton defender David Weir has played down talk of European football, despite his team lying in
second place in the Premiership after beating Liverpool.

Weir told BBC Radio Five Live: "We don't want to rest on our laurels and say we have achieved
anything yet. "I think you start taking your eye off the ball if you make statements and look too
far into the future. "If you start making predictions you soon fall back into trouble. The only
thing that matters is the next game." He said: "We are looking after each other and hard work goes
a long way in this league. We have definitely shown that. "Also injuries and suspensions haven't
cost us too badly and we have a lot of self-belief around the place.".

OUTPUT:
[
  "Everton is currently in second place in the Premiership.",
  "Everton recently beat Liverpool.",
  "David Weir is a defender for Everton.",
  "Weir believes it is important to focus on the next game rather than making predictions about the future.",
  "Weir believes hard work is important in the Premiership.",
  "Everton has not been significantly affected by injuries and suspensions.",
  "Everton has a lot of self-belief."
]
`;

export default class StatementExtractor {
    private model: GenerativeModel;

    constructor(genAI: GoogleGenerativeAI) {
        this.model = genAI.getGenerativeModel({
            model: 'gemini-1.5-flash-002',
            systemInstruction: SYSTEM_PROMPT,
            safetySettings: [
                {category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE},
                {category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE},
                {category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE},
                {category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE},
            ],
            generationConfig: {
                temperature: 0.1,
                responseMimeType: 'application/json',
                responseSchema: {
                    type: SchemaType.ARRAY,
                    items: {
                        type: SchemaType.STRING
                    }
                },
            },
        });
    }

    async extractStatements(input: string): Promise<Array<string>> {
        const result = await this.model.generateContent(input);
        try {
            return JSON.parse(result.response.text())    
        } catch(e) {
            console.log(result.response.text());
            console.error(e);
            throw e;
        }
    }
}