# On-device Gemma with MediaPipe

## Why this demo

* This demo showcases web performance/UX tips for on-device AI (in-browser). It shows that using a worker frees up the main thread (the animation runs smoothly). It also includes an implementation of message passing between the worker and the main thread, to display model readiness status updates to the user.
* The demo uses the Gemma 2B model, with the [MediaPipe LLM Inference API](https://ai.google.dev/edge/mediapipe/solutions/genai/llm_inference/web_js) (see [npm package](https://www.npmjs.com/package/@mediapipe/tasks-genai)).
* It works in Chrome and Edge.

<p align="center">
  <img src="https://github.com/user-attachments/assets/81608430-0b28-4a45-9d14-df619b20b9e7" />
</p>

## Quickstart

- Install: `npm i`
- Run: `npm start`

## Sources

Basic worker code is taken from [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Worker).
