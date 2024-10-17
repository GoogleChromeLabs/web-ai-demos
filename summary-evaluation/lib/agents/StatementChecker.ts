/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GenerativeModel, GoogleGenerativeAI, HarmBlockThreshold, HarmCategory, SchemaType } from "@google/generative-ai";

const SYSTEM_PROMPT = `
Analyze the provided list a statements and generate verdicts that state if a statement is supported
by the provided text in a 'verdict' field. The verdict must be 'yes', 'no' or 'idk'. When the
verdict is 'no' or 'idk' also include a 'reason' field that includes the correct facts from the
text.

EXAMPLE:
TEXT:
Everton's Weir cools Euro hopes

Everton defender David Weir has played down talk of European football, despite his team lying in second place in the Premiership after beating Liverpool.

Weir told BBC Radio Five Live: "We don't want to rest on our laurels and say we have achieved anything yet. "I think you start taking your eye off the ball if you make statements and look too far into the future. "If you start making predictions you soon fall back into trouble. The only thing that matters is the next game." He said: "We are looking after each other and hard work goes a long way in this league. We have definitely shown that. "Also injuries and suspensions haven't cost us too badly and we have a lot of self-belief around the place."

STATEMENT:
[
  "Everton is currently in second place in the Premiership.",
  "David Weir is a defender for Everton.",
  "Weir believes it is important to focus on the next game rather than making predictions about the future.",
  "Weir believes Everton's success is due to hard work, team spirit, and resilience in the face of injuries and suspensions.",
  "Neymar is the goalkeeper for Everton.",
  "Everton players had dozens of injuries in the season",
]

OUTPUT:
[
  {
    "statement": "Everton is currently in second place in the Premiership.",
    "verdict": "yes"
  },
  {
    "statement": "David Weir is a defender for Everton.",
    "verdict": "yes"
  },
  {
    "statement": "Weir believes it is important to focus on the next game rather than making predictions about the future.",
    "verdict": "yes"
  },
  {
    "statement": "Weir believes Everton's success is due to hard work, team spirit, and resilience in the face of injuries and suspensions.",
    "verdict": "yes"
  },
  {
    "statement": "Neymar is the goalkeeper for Everton.",
    "verdict": "no",
    "reason": "The text only mentions David Weir as a player for Everton and does not mention Neymar."
  },
  {
    "statement": "Everton players had dozens of injuries in the season",
    "verdict": "idk",
    "reason": "The text only says that injuries and suspensions haven't cost Everton too badly. It doesn't give a specific number of injuries."
  }
]
`;

export type StatementVerdict = {
    verdict: 'yes' | 'no' | 'idk'
}

export default class StatementChecker {
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
                      type: SchemaType.OBJECT,
                      properties: {
                        'statement': { type: SchemaType.STRING },
                        'verdict': { type: SchemaType.STRING },
                        'reason': { type: SchemaType.STRING },
                      },
                      required: ['statement', 'verdict']
                  }
              },

            },
        });
    }    

    async checkStatements(sourceText: string, statements: Array<string>): Promise<Array<{statement: string, verdict: string, reason: string}>> {
        const prompt = `TEXT:\n${sourceText}\n\nSTATEMENTS:\n${JSON.stringify(statements)}`;
        const result = await this.model.generateContent(prompt);
        return JSON.parse(result.response.text())
    }
}