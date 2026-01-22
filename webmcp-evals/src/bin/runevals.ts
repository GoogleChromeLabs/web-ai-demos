/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import { GoogleAiBackend } from '../backend/googleai.js';
import { readFile } from 'fs/promises';
import * as dotenv from 'dotenv';
import { deepEqual } from '../utils.js';
import { Eval } from '../types/evals.js';
import { OllamaBackend } from '../backend/ollama.js';
import { Tool, ToolsSchema } from '../types/tools.js';
import minimist from 'minimist';

const SYSTEM_PROMPT = `
# INSTRUCTIONS
You are an agent helping a user navigate a page via the tools made available to you. You must
use the tools available to help the user.

# ADDITIONAL CONTEXT
Today's date is: Monday 19th of January, 2026.
`;

dotenv.config();

const args = minimist(process.argv.slice(2));

const toolsSchema: ToolsSchema = JSON.parse(await readFile(args.tools, 'utf-8'));
const tools: Array<Tool> = toolsSchema.tools.map(t => {
    return {
        description: t.description,
        functionName: t.name,
        parameters: t.inputSchema || {},
    }
});
const tests: Array<Eval> = JSON.parse(await readFile(args.evals, 'utf-8'));

let backend;
switch (args.backend) {
    case 'ollama': backend = new OllamaBackend(process.env.OLLAMA_HOST!, args.model, SYSTEM_PROMPT, tools); break;
    default: backend = new GoogleAiBackend(process.env.GOOGLE_AI!, args.model, SYSTEM_PROMPT,tools);
}

let count = 0;
let correct = 0;
for (const test of tests) {
    count++;
    const response = await backend.execute(test.messages);
    if (response &&
            response.functionName === test.expectedCall.functionName &&
            deepEqual(response.args, test.expectedCall.arguments)) {
        correct++;
    } else {
        console.log(response, test.expectedCall);        
    }
    console.log(`${correct} of ${count}`);
}
