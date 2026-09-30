/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Shared by `availability()` and `create()`, so both ask about the same
// session. The transcript is in whatever language was spoken, so every output
// language the Prompt API supports is declared.
const SESSION_OPTIONS = {
  expectedInputs: [
    { type: "text", languages: ["de", "en", "es", "fr", "ja"] },
    { type: "audio" },
  ],
  expectedOutputs: [
    { type: "text", languages: ["de", "en", "es", "fr", "ja"] },
  ],
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

// Recording takes five seconds, which is long enough for the click that
// started it to no longer count as user activation, so this may have to wait
// for another one.
const createSession = async () => {
  const availability = await LanguageModel.availability(SESSION_OPTIONS);
  if (availability === "unavailable") {
    throw new Error("The Prompt API with audio input is unavailable.");
  }
  const downloadNeeded = availability !== "available";
  if (downloadNeeded && !navigator.userActivation.isActive) {
    downloadMessage.textContent =
      "Click anywhere or press a key to download the model.";
    downloadProgress.hidden = true;
    downloadStatus.hidden = false;
    await waitForUserActivation();
  }
  try {
    return await LanguageModel.create({
      ...SESSION_OPTIONS,
      monitor(m) {
        m.addEventListener("downloadprogress", (e) => {
          if (!downloadNeeded) {
            return;
          }
          downloadMessage.textContent = `Downloading the model: ${Math.round(
            e.loaded * 100,
          )}%`;
          downloadProgress.value = e.loaded;
          downloadProgress.hidden = false;
          downloadStatus.hidden = false;
        });
      },
    });
  } finally {
    downloadStatus.hidden = true;
  }
};

button.onclick = async () => {
  let audioStream;
  try {
    // Record speech
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks = [];
    const recorder = new MediaRecorder(audioStream);
    recorder.ondataavailable = ({ data }) => {
      chunks.push(data);
    };
    recorder.start();
    await new Promise((r) => setTimeout(r, 5000));
    recorder.stop();
    await new Promise((r) => (recorder.onstop = r));

    const blob = new Blob(chunks, { type: recorder.mimeType });

    // Save it for later
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.target = "_blank";
    a.download = "recording.mp3";
    a.click();

    await transcribe(blob);
  } catch (error) {
    log(error);
  } finally {
    logs.append(`<hr>`);
    audioStream?.getTracks().forEach((track) => track.stop());
  }
};

inputFile.oninput = async (event) => {
  try {
    const file = event.target.files[0];
    const blob = new Blob([file]);
    audioElement.src = URL.createObjectURL(blob);
    await transcribe(blob);
  } catch (error) {
    log(error);
  } finally {
    logs.append(`<hr>`);
  }
};

async function transcribe(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  
  const session = await createSession();

  const stream = session.promptStreaming([
    {
      role: "user",
      content: [
        { type: "text", value: "transcribe this audio" },
        { type: "audio", value: arrayBuffer },
      ],
    },
  ]);
  for await (const chunk of stream) {
    logs.append(chunk);
  }
}

function log(text) {
  logs.append(`${text}\r\n`);
}
