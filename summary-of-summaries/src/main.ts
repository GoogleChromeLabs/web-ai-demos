/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import TokenCounter from './TokenCounter';

// Declare Summarizer, LanguageModel and ai as globals, to avoid the TS compiler complaining about
// unknown objects in the global scope.
declare global {
    interface Window {
        Summarizer: any,
        LanguageModel: any,
        ai: any,
    }
}

const MAX_TOKENS: number = 800;

const aiSpinner = document.getElementById('ai-spinner') as HTMLDivElement;
const inputTextArea = document.getElementById('input') as HTMLTextAreaElement;
const outputTextArea = document.getElementById('output') as HTMLTextAreaElement;
const button = document.getElementById('split-it') as HTMLButtonElement;
const statusSpan = document.getElementById('status') as HTMLSpanElement;

const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 3000,
    chunkOverlap: 200,
});

const tokenCounter = await TokenCounter.create();
let summarizer;
async function recursiveSummarizer(parts: string[]) {
    statusSpan.innerText = `Summarizing ${parts.length} parts.`;
    let summaries: string[] = [];
    let currentSummary: string[] = [];
    for (let i = 0; i < parts.length; i++) {
        statusSpan.innerText = `Summarizing part ${i + 1} of ${parts.length}.`;
        const summarizedPart = await summarizer!.summarize(parts[i].trim());
        if (await tokenCounter.countTokens([...currentSummary, summarizedPart].join('\n')) > MAX_TOKENS) {
            summaries.push(currentSummary.join('\n'));
            currentSummary = [summarizedPart];
        } else {
            currentSummary.push(summarizedPart);
        }
    }
    summaries.push(currentSummary.join('\n'));
    if (summaries.length == 1) {
        return await summarizer!.summarize(summaries[0]);
    }
    return recursiveSummarizer(summaries);
}

button.addEventListener('click', async () => {
    button.disabled = true;
    inputTextArea.disabled = true;
    aiSpinner.classList.add('visible');
    const splits = await splitter.splitText(inputTextArea.value);
    statusSpan.innerText = `Split into ${splits.length} parts.`
    const summary = await recursiveSummarizer(splits);
    outputTextArea.value = summary;
    aiSpinner.classList.remove('visible');
    statusSpan.innerText = 'Done!';
    button.disabled = false;
    inputTextArea.disabled = false;
});

const checkSummarizerSupport = async (): Promise<boolean> => {
    // Checks availability against the new API shape.
    if (self.Summarizer !== undefined) {
      let availability = await window.Summarizer.availability();
      return availability === 'available' || availability === 'downloadable';
    }
  
    // Checks availability agains the old API shape.
    let capabilities = await window.ai.summarizer.capabilities();
    return capabilities.available === 'readily' || capabilities.available === 'after-download';  
  }

  if (self.Summarizer || (window.ai && window.ai.summarizer)) {
    if (await checkSummarizerSupport()) {
        // Check availaiblity of the model here so the user can be warned about the model download agains the new API
        // shape in Chrome canary and the previous one currently in stable.
        const capabilites = await (self.Summarizer ? self.Summarizer.availability() : self.ai.summarizer.capabilities());
        if (capabilites.available === 'after-download' || capabilites === 'downloadable') {
            statusSpan.innerText = `Hold on, Chrome is downloading the model. This can take a few minutes..`;    
        } else {
            statusSpan.innerText = `Getting the model ready.`;
        }

        const modelDownloadCallback = (e: any) => {
            statusSpan.innerText = `Hold on, Chrome is downloading the model. Progress: ${e.loaded} of ${e.total}.`;
        };

        const createOptions = {
            format: 'plain-text',
            type: 'tl;dr',
            length: 'long',
            monitor: (m: any) => m.addEventListener('downloadprogress', modelDownloadCallback),
        };

        // Trigger the model download, using both the old and new API namespaces.
        summarizer = await (self.Summarizer ?
                self.Summarizer.create(createOptions) : self.ai.summarizer.create(createOptions));
        statusSpan.innerText = `Awaiting for input.`;
        button.disabled = false;
        inputTextArea.disabled = false;
    } else {
        statusSpan.innerText = `Your device doesn't support the Summarizer API.`;    
    }
  } else {
    statusSpan.innerText = `Your browser doesn't support the Summarizer API.`;    
  }
