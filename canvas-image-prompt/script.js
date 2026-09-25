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

const createSession = async () => {
  const availability = await LanguageModel.availability(SESSION_OPTIONS);
  if (availability === "unavailable") {
    throw new Error("The Prompt API with image input is unavailable.");
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

button.onclick = async (event) => {
  try {
    const session = await createSession();
    const prompt =
      "Give a helpful artistic critique of how well the second image matches the first:";

    const stream = session.promptStreaming([
      {
        role: "user",
        content: [
          { type: "text", value: prompt },
          { type: "image", value: referenceImage },
          { type: "image", value: canvas },
        ],
      },
    ]);
    for await (const chunk of stream) {
      logs.append(chunk);
    }
  } catch (error) {
    logs.append(`Error: ${error}`);
  }
};

referenceImage.onload = () => {
  canvas.width = referenceImage.width;
  canvas.height = referenceImage.height;

  let isPainting = false;

  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.strokeStyle = "white";

  const draw = ({ clientX, clientY }) => {
    if (isPainting) {
      ctx.lineTo(clientX - canvas.offsetLeft, clientY - canvas.offsetTop);
      ctx.stroke();
    }
  };

  canvas.addEventListener("mousedown", () => {
    isPainting = true;
  });

  canvas.addEventListener("mouseup", () => {
    isPainting = false;
    ctx.beginPath();
  });

  canvas.addEventListener("mousemove", draw);
}
referenceImage.src = "monalisa.jpg";
