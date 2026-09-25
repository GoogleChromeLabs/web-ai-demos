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

// The languages are part of every session, so checking whether the device can
// summarize at all and creating a session both ask about them.
const LANGUAGE_OPTIONS = {
  expectedInputLanguages: ['en'],
  expectedContextLanguages: ['en'],
  outputLanguage: 'en',
};

/*
 * Resolves once the user has interacted with the page. Chrome only starts a model download with
 * user activation, which a tap, click, or key press grants.
 */
const waitForUserActivation = (): Promise<void> =>
  new Promise((resolve) => {
    const controller = new AbortController();
    const onInteraction = () => {
      if (navigator.userActivation.isActive) {
        controller.abort();
        resolve();
      }
    };
    for (const type of ['keydown', 'mousedown', 'pointerup', 'touchend']) {
      document.addEventListener(type, onInteraction, {
        capture: true,
        signal: controller.signal,
      });
    }
  });

/*
 * Creates a summarization session. If the model has already been downloaded, this function will
 * create the session and return it. If the model needs to be downloaded, this function will
 * wait for user activation, which Chrome requires to start the download, and then for the
 * download to finish before resolving the promise.
 *
 * If a downloadProgressCallback is provided, the function will add the callback to the session
 * creation, for as long as the model is being downloaded.
 *
 * `availability()` is asked with exactly the options `create()` gets. If it is `unavailable`, the
 * function will throw an error.
 */
const createSummarizationSession = async (
  type: SummarizerType = 'tldr',
  format: SummarizerFormat = 'plain-text',
  length: SummarizerLength = 'medium',
  downloadProgressListener?: (ev: ProgressEvent) => void): Promise<Summarizer> => {

  const options = { ...LANGUAGE_OPTIONS, type, format, length };
  const availability = await window.Summarizer.availability(options);
  if (availability === 'unavailable') {
    throw new Error('AI Summarization is not supported');
  }

  const downloadNeeded = availability !== 'available';
  if (downloadNeeded && !navigator.userActivation.isActive) {
    output.textContent = 'Click anywhere or press a key to download the model.';
    await waitForUserActivation();
  }

  let monitor = undefined;
  if (downloadNeeded && downloadProgressListener) {
      monitor = (m: CreateMonitor) => {
          m.addEventListener('downloadprogress', downloadProgressListener);
      };
  }

  return window.Summarizer.create({ ...options, monitor });
}

/*
 * Checks if the device supports the Summarizer API (rather than if the browser supports the API).
 * This method returns `true` when the device is capable of running the Summarizer API and `false`
 * when it is not. A model that is still downloading counts as supported.
 */
const checkSummarizerSupport = async (): Promise<boolean> => {
  let availability = await window.Summarizer.availability(LANGUAGE_OPTIONS);
  return availability !== 'unavailable';
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
        summaryTypeSelect.value as SummarizerType,
        summaryFormatSelect.value as SummarizerFormat,
        summaryLengthSelect.value as SummarizerLength,
        (e) => {
          output.textContent = `Downloading the model: ${Math.round(e.loaded * 100)}%`;
        },
      );
      output.textContent = 'Generating summary...';
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
