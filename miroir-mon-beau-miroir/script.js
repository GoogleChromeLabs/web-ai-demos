/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Shared by `availability()` and `create()`, so both ask about the same
// session.
const SESSION_OPTIONS = {
  expectedInputs: [{ type: "text", languages: ["en"] }, { type: "image" }],
  expectedOutputs: [{ type: "text", languages: ["en"] }],
};

// Resolves once the user has interacted with the page. Chrome only starts a
// model download with user activation, which a tap, click, or key press grants.
const waitForUserActivation = () =>
  new Promise((resolve) => {
    const controller = new AbortController();
    const onInteraction = () => {
      if (navigator.userActivation.isActive) {
        controller.abort();
        resolve();
      }
    };
    for (const type of ["keydown", "mousedown", "pointerup", "touchend"]) {
      document.addEventListener(type, onInteraction, {
        capture: true,
        signal: controller.signal,
      });
    }
  });

// Answering the camera permission prompt can take long enough for the click
// that started it to no longer count as user activation, so this may have to
// wait for another one.
async function createSession() {
  const availability = await LanguageModel.availability(SESSION_OPTIONS);
  if (availability === "unavailable") {
    throw new Error("The Prompt API with image input is unavailable.");
  }
  const downloadNeeded = availability !== "available";
  if (downloadNeeded && !navigator.userActivation.isActive) {
    statusMessage.textContent =
      "Click anywhere or press a key to download the model.";
    await waitForUserActivation();
    statusMessage.textContent = "";
  }
  try {
    return await LanguageModel.create({
      ...SESSION_OPTIONS,
      monitor(m) {
        m.addEventListener("downloadprogress", (e) => {
          if (!downloadNeeded) {
            return;
          }
          statusMessage.textContent = `Downloading the model: ${Math.round(
            e.loaded * 100,
          )}%`;
          downloadProgress.value = e.loaded;
          downloadProgress.hidden = false;
        });
      },
    });
  } finally {
    if (downloadNeeded) {
      statusMessage.textContent = "";
    }
    downloadProgress.hidden = true;
  }
}

async function describePerson() {
  const session = await createSession();
  const prompt =
    "Using 'you,' humorously describe the person in this image. Emphasize the absurdity of their pose and expression.";

  const response = await session.prompt([
    {
      role: "user",
      content: [
        { type: "text", value: prompt },
        { type: "image", value: video },
      ],
    },
  ]);
  speechSynthesis.speak(new SpeechSynthesisUtterance(response));

  const params = new URLSearchParams(window.location.search);
  if (params.has("debug")) {
    logs.innerHTML = `Debug: ${response}`;
  }
}

button.onclick = async () => {
  video.classList.add("blur");
  try {
    video.srcObject = await navigator.mediaDevices.getUserMedia({
      video: true,
    });
    await video.play();
    await describePerson();
  } catch (error) {
    statusMessage.textContent = error;
  } finally {
    video.classList.remove("blur");
  }
};

window.onunload = speechSynthesis.cancel();
