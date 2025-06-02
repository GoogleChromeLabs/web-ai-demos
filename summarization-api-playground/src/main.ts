/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import './style.css'

// Declare Summarizer as a global, to avoid the TS compiler complaining about unknown
// objects in the global scope.
declare global {
  interface Window {
      Summarizer: any;
  }
}

const inputTextArea = document.querySelector('#input') as HTMLTextAreaElement;
const summaryTypeSelect = document.querySelector('#type') as HTMLSelectElement;
const summaryFormatSelect = document.querySelector('#format') as HTMLSelectElement;
const summaryLengthSelect = document.querySelector('#length') as HTMLSelectElement;
const characterCountSpan = document.querySelector('#character-count') as HTMLSpanElement;
const summarizationUnsupportedDialog = document.querySelector('#summarization-unsupported') as HTMLDivElement;
const summarizationUnavailableDialog = document.querySelector('#summarization-unavailable') as HTMLDivElement;
const output = document.querySelector('#output') as HTMLDivElement;

/*
 * Creates a summarization session. If the model has already been downloaded, this function will
 * create the session and return it. If the model needs to be downloaded, this function will
 * wait for the download to finish before resolving the promise.
 *
 * If a downloadProgressCallback is provided, the function will add the callback to the session
 * creation.
 *
 * The function expects the model availability to be either `readily` or `after-download`, so the
 * availability must be checked before calling it. If availability is `no`, the function will throw
 * an error.
 */
const createSummarizationSession = async (
  type: AISummarizerType = 'tldr',
  format: AISummarizerFormat = 'plain-text',
  length: AISummarizerLength = 'medium',
  downloadProgressListener?: (ev: DownloadProgressEvent) => void): Promise<AISummarizer> => {
  let monitor = undefined;
  if (downloadProgressListener) {
      monitor = (m: AICreateMonitor) => {
          m.addEventListener('downloadprogress', downloadProgressListener);
      };
  }

  if (!(await checkSummarizerSupport())) {
    throw new Error('AI Summarization is not supported');
  }

  return window.Summarizer.create({ type, format, length, monitor });
}

/*
 * Checks if the device supports the Summarizer API (rather than if the browser supports the API).
 * This method returns `true` when the device is capable of running the Summarizer API and `false`
 * when it is not.
 */
const checkSummarizerSupport = async (): Promise<boolean> => {
  let availability = await window.Summarizer.availability();
  return availability === 'available' || availability === 'downloadable';
}

/*
 * Initializes the application.
 * This function will check for the availability of the Summarization API, and if the device is
 * able to run it before setting up the listeners to summarize the input added to the textarea.
 */
const initializeApplication = async () => {
  const summarizationApiAvailable = self.Summarizer !== undefined;
  if (!summarizationApiAvailable) {
    summarizationUnavailableDialog.style.display = 'block';
    return;
  }

  const canSummarize = await checkSummarizerSupport();
  if (!canSummarize) {
    summarizationUnsupportedDialog.style.display = 'block';
    return;
  }

  let timeout: number | undefined = undefined;
  function scheduleSummarization() {
    // Debounces the call to the summarization API. This will run the summarization once the user
    // hasn't typed anything for at least 1 second.
    clearTimeout(timeout);
    timeout = setTimeout(async () => {
      output.textContent = 'Generating summary...';
      let session = await createSummarizationSession(
        summaryTypeSelect.value as AISummarizerType,
        summaryFormatSelect.value as AISummarizerFormat,
        summaryLengthSelect.value as AISummarizerLength,
      );
      let inputUsage = await session.measureInputUsage(inputTextArea.value);
      characterCountSpan.textContent = `${inputUsage.toFixed()} of ${session.inputQuota}`;
      let summary = await session.summarize(inputTextArea.value);
      session.destroy();
      output.textContent = summary;
    }, 1000);
  }

  summaryTypeSelect.addEventListener('change', scheduleSummarization);
  summaryFormatSelect.addEventListener('change', scheduleSummarization);
  summaryLengthSelect.addEventListener('change', scheduleSummarization);

  inputTextArea.addEventListener('input', () => {
    scheduleSummarization();
  });
}

initializeApplication();
