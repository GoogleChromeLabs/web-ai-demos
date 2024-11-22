/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import TokenCounter from './TokenCounter';

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
    // Do a first capabilities check. If 'no' is returned, it might mean the model hasn't been
    // bootstrapped by calling `create()`. In this case, `create()` is called, which should result
    // in an exception being raised. The exception is ignored, but now `capabilities()` should
    // reflect the actual state of the API, with `no` meaning the device is unable to run the API.
    let capabilites = await self.ai.summarizer.capabilities();
    if (capabilites.available === 'readily' || capabilites.available === 'after-download') {
      return true;
    }
  
    try {
      await self.ai.summarizer.create();
    } catch (e) {
        console.log(e);
    }
  
    capabilites = await self.ai.summarizer.capabilities();
    return capabilites.available !== 'no';
  }

  if (self.ai && self.ai.summarizer) {
    if (await checkSummarizerSupport()) {
        // Check capabilities here so the user can be warned about the model download.
        const capabilites = await self.ai.summarizer.capabilities();
        if (capabilites.available === 'after-download') {
            statusSpan.innerText = `Hold on, Chrome is downloading the model. This can take a few minutes..`;    
        } else {
            statusSpan.innerText = `Getting the model ready.`;
        }

        const modelDownloadCallback = (e: DownloadProgressEvent) => {
            statusSpan.innerText = `Hold on, Chrome is downloading the model. Progress: ${e.loaded} of ${e.total}.`;
        };

        // Trigger the model download.
        summarizer = await self.ai.summarizer.create({
            format: 'plain-text',
            type: 'tl;dr',
            length: 'long',
            monitor: (m: AICreateMonitor) => m.addEventListener('downloadprogress', modelDownloadCallback),
        });        
        statusSpan.innerText = `Awaiting for input.`;
        button.disabled = false;
        inputTextArea.disabled = false;
    } else {
        const capabilites = await self.ai.summarizer.capabilities();
        console.log(capabilites);
        statusSpan.innerText = `Your device doesn't support the Summarizer API.`;    
    }
  } else {
    statusSpan.innerText = `Your browser doesn't support the Summarizer API.`;    
  }
