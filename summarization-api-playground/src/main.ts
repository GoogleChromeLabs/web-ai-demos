/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import './style.css'

// The underlying model has a context of 1,024 tokens, out of which 26 are used by the internal prompt,
// leaving about 998 tokens for the input text. Each token corresponds, roughly, to about 4 characters, so 4,000
// is used as a limit to warn the user that the content might be too long to summarize.
const MAX_MODEL_CHARS = 4000;
const inputTextArea = document.querySelector('#input') as HTMLTextAreaElement;
const summaryTypeSelect = document.querySelector('#type') as HTMLSelectElement;
const summaryFormatSelect = document.querySelector('#format') as HTMLSelectElement;
const summaryLengthSelect = document.querySelector('#length') as HTMLSelectElement;
const characterCountSpan = document.querySelector('#character-count') as HTMLSpanElement;
const characterCountExceededSpan = document.querySelector('#character-count-exceed') as HTMLSpanElement;
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
  type: AISummarizerType,
  format: AISummarizerFormat,
  length: AISummarizerLength,
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

  return self.ai.summarizer.create({ type, format, length, monitor });
}

/*
 * Checks if the device supports the Summarizer API (rather than if the browser supports the API).
 * This method returns `true` when the device is capable of running the Summarizer API and `false`
 * when it is not.
 */
const checkSummarizerSupport = async (): Promise<boolean> => {
  // Do a first capabilities check. If 'no' is returned, it might mean the model hasn't been
  // bootstrapped by calling `create()`. In this case, `create()` is called, which should result
  // in an exception being raised. The exception is ignored, but now `capabilities()` should
  // reflect the actual state of the API, with `no` meaning the device is unable to run the API.
  let availability = await self.ai.summarizer.availability();
  if (availability === 'available' || availability === 'downloadable') {
    return true;
  }

  try {
    await self.ai.summarizer.create();
  } catch (e) { }

  availability = await self.ai.summarizer.availability();
  return availability !== 'unavailable';
}

/*
 * Initializes the application.
 * This function will check for the availability of the Summarization API, and if the device is
 * able to run it before setting up the listeners to summarize the input added to the textarea.
 */
const initializeApplication = async () => {
  const summarizationApiAvailable = self.ai !== undefined && self.ai.summarizer !== undefined;
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
      let summary = await session.summarize(inputTextArea.value);
      session.destroy();
      output.textContent = summary;
    }, 1000);
  }

  summaryTypeSelect.addEventListener('change', scheduleSummarization);
  summaryFormatSelect.addEventListener('change', scheduleSummarization);
  summaryLengthSelect.addEventListener('change', scheduleSummarization);

  inputTextArea.addEventListener('input', () => {
    characterCountSpan.textContent = inputTextArea.value.length.toFixed();
    if (inputTextArea.value.length > MAX_MODEL_CHARS) {
      characterCountSpan.classList.add('tokens-exceeded');
      characterCountExceededSpan.classList.remove('hidden');
    } else {
      characterCountSpan.classList.remove('tokens-exceeded');
      characterCountExceededSpan.classList.add('hidden');
    }
    scheduleSummarization();
  });
}

initializeApplication();
