# Client-side Gemma with MediaPipe without a worker

## Why this demo

* This demo showcases is the non-worker pendant of the [worker demo](https://github.com/GoogleChromeLabs/web-ai-demos/tree/main/perf-client-side-gemma-worker). It shows that not using a worker creates a performance bottleneck: the animation jitters, because the model preparation steps and the inference work take place on the main thread.
* The demo uses the Gemma 2B model, with the [MediaPipe LLM Inference API](https://ai.google.dev/edge/mediapipe/solutions/genai/llm_inference/web_js) (see [npm package](https://www.npmjs.com/package/@mediapipe/tasks-genai)).

<p align="center">
  <img src="https://github.com/user-attachments/assets/81608430-0b28-4a45-9d14-df619b20b9e7" width="300"/>
</p>

## Browser support and prerequisites
Because the MediaPipe LLM Inference API relies on WebGPU, this demo runs in all browsers that support WebGPU. As of August 2024:
* Chrome
* Edge
* Firefox Nightly ⚠️ Turn on the flag `dom.webgpu.workers.enabled` in `about:config`
* Safari Technology Preview

## Quickstart

- Install: `npm i`
- Run: `npm start`

## Sources

Basic worker code is taken from [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Worker).
