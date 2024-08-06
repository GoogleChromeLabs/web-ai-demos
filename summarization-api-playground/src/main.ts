/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import './style.css'

const inputTextArea = document.querySelector('#input') as HTMLTextAreaElement;
const characterCountSpan = document.querySelector('#character-count') as HTMLSpanElement;
const summarizationUnsupportedDialog = document.querySelector('#summarization-unsupported') as HTMLDialogElement;
const summarizationUnavailableDialog = document.querySelector('#summarization-unavailable') as HTMLDialogElement;
const output = document.querySelector('#output') as HTMLDivElement;

/*
 * Creates a summarization session. If the model has already been downloaded, this function will
 * create the session and return it. If the model needs to be downloaded, the this function will
 * wait for the download to finish before resolving the promise.
 * 
 * If a downloadProgressCallback is provided, the function will add the callback to the session
 * creation.
 * 
 * The function expects the model availability to be either `readily` or `after-download`, so the
 * availability must be checked before calling it. If availabilityis `no`, the function will throw
 *  an error.
 */
const createSummarizationSession = async (downloadProgressCallback?: AIModelDownloadCallback): Promise<AISummarizerSession> =>  {
  const canSummarize = await window.ai.summarizer!.capabilities();
  if (canSummarize.available === 'no') {
    throw new Error('AI Summarization is not supported');
  }

  const summarizationSession = await window.ai.summarizer!.create();
  if (canSummarize.available === 'after-download') {
    if (downloadProgressCallback) {
      summarizationSession.addEventListener('downloadprogress', downloadProgressCallback);
    }
    await summarizationSession.ready;
  }

  return summarizationSession;
}

/*
 * Initializes the application.
 * This function will check for the availability of the Summarization API, and if the device is
 * able to run it before setting up the listeners to summarize the input added to the textarea.
 */
const initializeApplication = async () => {
  const summarizationApiAvailable = window.ai !== undefined && window.ai.summarizer !== undefined;
  if (!summarizationApiAvailable) {
    summarizationUnavailableDialog.showModal();
    return;
  }

  const canSummarize = await window.ai.summarizer!.capabilities();
  if (canSummarize.available === 'no') {
    summarizationUnsupportedDialog.showModal();
    return;
  }

  let timeout: number | undefined = undefined;
  inputTextArea.addEventListener('input', () => {
    characterCountSpan.textContent = inputTextArea.value.length.toFixed();
    clearTimeout(timeout);
    timeout = setTimeout(async () => {
      output.textContent = 'Generating summary...';
      let session = await createSummarizationSession();
      let summary = await session.summarize(inputTextArea.value);
      session.destroy();
      output.textContent = summary;
    }, 1000);
  });  
}

initializeApplication();
