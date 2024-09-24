# Client-side Gemma with MediaPipe without a worker

## Why this demo

* This demo showcases the non-worker pendant of the [worker demo](https://github.com/GoogleChromeLabs/web-ai-demos/tree/main/perf-client-side-gemma-worker). It shows that not using a worker creates a performance bottleneck: the animation jitters, as the model preparation steps and the inference work take place on the main thread.
* The demo uses the Gemma 2B model, with the [MediaPipe LLM Inference API](https://ai.google.dev/edge/mediapipe/solutions/genai/llm_inference/web_js) (see [npm package](https://www.npmjs.com/package/@mediapipe/tasks-genai)).

## Browser support and prerequisites
Because the MediaPipe LLM Inference API relies on WebGPU, this demo runs in all browsers that support WebGPU. As of August 2024:
* Chrome
* Edge
* Firefox Nightly
* Safari Technology Preview

## Quickstart

- Install: `npm i`
- Run: `npm start`
