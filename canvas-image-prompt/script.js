/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

button.onclick = async (event) => {
  try {
    const session = await LanguageModel.create({
      expectedInputs: [{ type: "image" }],
    });
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
      logs.innerHTML += chunk;
    }
  } catch (error) {
    logs.innerHTML += `Error: ${error}`;
  }
};

/* Canvas */

canvas.width = referenceImage.width;
canvas.height = referenceImage.height;

let isPainting = false;

const ctx = canvas.getContext("2d");
ctx.lineWidth = 4;
ctx.lineCap = "round";

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
