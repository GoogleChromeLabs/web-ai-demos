/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

// Declare Summarizer, LanguageModel and ai as globals, to avoid the TS compiler complaining about
// unknown objects in the global scope.
declare global {
    interface Window {
        Summarizer: any,
    }
}

const aiSpinner = document.getElementById('ai-spinner') as HTMLDivElement;
const inputTextArea = document.getElementById('input') as HTMLTextAreaElement;
const outputTextArea = document.getElementById('output') as HTMLTextAreaElement;
const setupButton = document.getElementById('setup') as HTMLButtonElement;
const splitItButton = document.getElementById('split-it') as HTMLButtonElement;
const statusSpan = document.getElementById('status') as HTMLSpanElement;

let splitter;
let summarizer;
async function recursiveSummarizer(parts: string[]) {
    statusSpan.innerText = `Summarizing ${parts.length} parts.`;
    let summaries: string[] = [];
    let currentSummary: string[] = [];
    for (let i = 0; i < parts.length; i++) {
        statusSpan.innerText = `Summarizing part ${i + 1} of ${parts.length}.`;
        const summarizedPart = await summarizer!.summarize(parts[i].trim());
        const tokenCount = await summarizer!.measureInputUsage([...currentSummary, summarizedPart].join('\n'));
        if (tokenCount > summarizer!.inputQuota) {
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

splitItButton.addEventListener('click', async () => {
    splitItButton.disabled = true;
    inputTextArea.disabled = true;
    aiSpinner.classList.add('visible');
    const splits = await splitter!.splitText(inputTextArea.value);
    statusSpan.innerText = `Split into ${splits.length} parts.`
    const summary = await recursiveSummarizer(splits);
    outputTextArea.value = summary;
    aiSpinner.classList.remove('visible');
    statusSpan.innerText = 'Done!';
    splitItButton.disabled = false;
    inputTextArea.disabled = false;
});

const checkSummarizerSupport = async (): Promise<boolean> => {
    // Checks model availability.
    let availability = await window.Summarizer.availability();
    return availability === 'available' || availability === 'downloadable';
 }

setupButton.addEventListener('click', async () => {
  if (window.Summarizer) {
    if (await checkSummarizerSupport()) {
        // Check availaiblity of the model so the user can be warned about the model download.
        const availability = await self.Summarizer.availability();
        if (availability === 'downloadable') {
            statusSpan.innerText = `Hold on, Chrome is downloading the model. This can take a few minutes..`;    
        } else {
            statusSpan.innerText = `Getting the model ready.`;
        }

        const modelDownloadCallback = (e: any) => {
            statusSpan.innerText = `Hold on, Chrome is downloading the model. Progress: ${e.loaded} of ${e.total}.`;
        };

        const createOptions = {
            format: 'plain-text',
            type: 'tldr',
            length: 'long',
            monitor: (m: any) => m.addEventListener('downloadprogress', modelDownloadCallback),
        };

        // Trigger the model download.
        summarizer = await self.Summarizer.create(createOptions);

        // chunkSize takes the number of characters in the split as a parameters. `inputQuota`
        // is the number of tokens rather than characters. On most models, one token contains,
        // on average, 4 characters, and in the worst case scenario, a token would equal to 1
        // character, so chunkSize will be always smaller or equal to inputQuota.
        splitter = new RecursiveCharacterTextSplitter({
            chunkSize: summarizer.inputQuota,
            chunkOverlap: 200,
        });                
        statusSpan.innerText = `Awaiting for input.`;
        splitItButton.disabled = false;
        inputTextArea.disabled = false;
    } else {
        statusSpan.innerText = `Your device doesn't support the Summarizer API.`;    
    }
  } else {
    statusSpan.innerText = `Your browser doesn't support the Summarizer API.`;    
  }
 });