/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { marked } from "https://cdn.jsdelivr.net/npm/marked@13.0.3/lib/marked.esm.js";
import DOMPurify from "https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.es.mjs";

const NUMBER_FORMAT_LANGUAGE = "en-US";
const SYSTEM_PROMPT = "You are a helpful and friendly assistant.";

(async () => {
  const errorMessage = document.getElementById("error-message");
  const costSpan = document.getElementById("cost");
  const promptArea = document.getElementById("prompt-area");
  const problematicArea = document.getElementById("problematic-area");
  const promptInput = document.getElementById("prompt-input");
  const responseArea = document.getElementById("response-area");
  const copyLinkButton = document.getElementById("copy-link-button");
  const resetButton = document.getElementById("reset-button");
  const copyHelper = document.querySelector("small");
  const rawResponse = document.querySelector("details div");
  const form = document.querySelector("form");
  const maxTokensInfo = document.getElementById("max-tokens");
  const temperatureInfo = document.getElementById("temperature");
  const tokensLeftInfo = document.getElementById("tokens-left");
  const tokensSoFarInfo = document.getElementById("tokens-so-far");
  const topKInfo = document.getElementById("top-k");
  const sessionTemperature = document.getElementById("session-temperature");
  const sessionTopK = document.getElementById("session-top-k");

  responseArea.style.display = "none";

  let session = null;

  if (!('LanguageModel' in self)) {
    errorMessage.style.display = "block";
    errorMessage.innerHTML = `Your browser doesn't support the Prompt API. If you're on Chrome, join the <a href="https://goo.gle/chrome-ai-dev-preview-join">Early Preview Program</a> to enable it.`;
    return;
  }

  promptArea.style.display = "block";
  copyLinkButton.style.display = "none";
  copyHelper.style.display = "none";

  const promptModel = async (highlight = false) => {
    copyLinkButton.style.display = "none";
    copyHelper.style.display = "none";
    problematicArea.style.display = "none";
    const prompt = promptInput.value.trim();
    if (!prompt) return;
    responseArea.style.display = "block";
    const heading = document.createElement("h3");
    heading.classList.add("prompt", "speech-bubble");
    heading.textContent = prompt;
    responseArea.append(heading);
    const p = document.createElement("p");
    p.classList.add("response", "speech-bubble");
    p.textContent = "Generating response...";
    responseArea.append(p);

    try {
      if (!session) {
        await updateSession();
        updateStats();
      }
      const stream = await session.promptStreaming(prompt);

      let result = '';
      let previousChunk = '';
      for await (const chunk of stream) {
        const newChunk = chunk.startsWith(previousChunk)
            ? chunk.slice(previousChunk.length) : chunk;
        result += newChunk;
        p.innerHTML = DOMPurify.sanitize(marked.parse(result));
        rawResponse.innerText = result;
        previousChunk = chunk;
      }
    } catch (error) {
      p.textContent = `Error: ${error.message}`;
    } finally {
      if (highlight) {
        problematicArea.style.display = "block";
        problematicArea.querySelector("#problem").innerText =
          decodeURIComponent(highlight).trim();
      }
      copyLinkButton.style.display = "inline-block";
      copyHelper.style.display = "inline";
      updateStats();
    }
  };

  const updateStats = () => {
    if (!session) {
      return;
    }

    const numberFormat = new Intl.NumberFormat(NUMBER_FORMAT_LANGUAGE);
    const decimalNumberFormat = new Intl.NumberFormat(
      NUMBER_FORMAT_LANGUAGE,
      { minimumFractionDigits: 1, maximumFractionDigits: 1 },
    );

    temperatureInfo.textContent = decimalNumberFormat.format(session.temperature);
    topKInfo.textContent = numberFormat.format(session.topK);

    // In the new API shape, currently in Chrome Canary, `session.maxTokens` was renamed to
    // `session.inputQuota` and `session.tokensSoFar` was renamed to `session.inputUsage`.
    // `session.tokensSoFar` was removed, but the value can be calculated by subtracting
    // `inputUsage` from `inputQuota`. Both APIs shapes are checked in the code below.
    maxTokensInfo.textContent = numberFormat.format(session.inputQuota || session.maxTokens);
    tokensLeftInfo.textContent =
        numberFormat.format(session.tokensSoFar || session.inputQuota - session.inputUsage);
    tokensSoFarInfo.textContent = numberFormat.format(session.inputUsage || session.tokensSoFar);
  };

  const params = new URLSearchParams(location.search);
  const urlPrompt = params.get("prompt");
  const highlight = params.get("highlight");
  if (urlPrompt) {
    promptInput.value = decodeURIComponent(urlPrompt).trim();
    await promptModel(highlight);
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    await promptModel();
  });

  promptInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.dispatchEvent(new Event("submit"));
    }
  });

  promptInput.addEventListener("focus", () => {
    promptInput.select();
  });

  promptInput.addEventListener("input", async () => {
    const value = promptInput.value.trim();
    if (!value) {
      return;
    }

    let cost;

    // The API that returns the token count for a prompt changed between Chrome Stable and Canary
    // and the method was renamed from `countPromptTokens(input)` to `measureInputUsage(input)`.
    // The code below ensures both cases are handled.
    if (session.countPromptTokens) {
      cost = await session.countPromptTokens(value);
    } else if (session.measureInputUsage) {
      cost = await session.measureInputUsage(value);
    }

    if (!cost) {
      return;
    }
    costSpan.textContent = `${cost} token${cost === 1 ? '' : 's'}`;
  });

  const resetUI = () => {
    responseArea.style.display = "none";
    responseArea.innerHTML = "";
    rawResponse.innerHTML = "";
    problematicArea.style.display = "none";
    copyLinkButton.style.display = "none";
    copyHelper.style.display = "none";
    maxTokensInfo.textContent = "";
    temperatureInfo.textContent = "";
    tokensLeftInfo.textContent = "";
    tokensSoFarInfo.textContent = "";
    topKInfo.textContent = "";
    promptInput.focus();
  };

  resetButton.addEventListener("click", () => {
    promptInput.value = "";
    resetUI();
    session.destroy();
    session = null;
    updateSession();
  });

  copyLinkButton.addEventListener("click", () => {
    const prompt = promptInput.value.trim();
    if (!prompt) return;
    const url = new URL(self.location.href);
    url.searchParams.set("prompt", encodeURIComponent(prompt));
    const selection = getSelection().toString() || "";
    if (selection) {
      url.searchParams.set("highlight", encodeURIComponent(selection));
    } else {
      url.searchParams.delete("highlight");
    }
    navigator.clipboard.writeText(url.toString()).catch((err) => {
      alert("Failed to copy link: ", err);
    });
    const text = copyLinkButton.textContent;
    copyLinkButton.textContent = "Copied";
    setTimeout(() => {
      copyLinkButton.textContent = text;
    }, 3000);
  });

  const updateSession = async () => {
    if (self.LanguageModel) {
      session = await LanguageModel.create({
        temperature: Number(sessionTemperature.value),
        topK: Number(sessionTopK.value),
        initialPrompts: [
          {
            role: 'system',
            content: SYSTEM_PROMPT,
          }
        ],
      });
    }
    resetUI();
    updateStats();
  };

  sessionTemperature.addEventListener("input", async () => {
    await updateSession();
  });

  sessionTopK.addEventListener("input", async () => {
    await updateSession();
  });

  if (!session) {
    let { defaultTopK, maxTopK, defaultTemperature, maxTemperature } = "LanguageModel" in self ?
      await LanguageModel.params() : {defaultTopK: 3, maxTopK: 128, defaultTemperature: 1, maxTemperature: 2};
    defaultTopK ||= 3;  // https://crbug.com/441711146
    sessionTemperature.value = defaultTemperature;
    sessionTemperature.max = maxTemperature;
    sessionTopK.value = defaultTopK;
    sessionTopK.max = maxTopK;
    await updateSession();
  }
})();
