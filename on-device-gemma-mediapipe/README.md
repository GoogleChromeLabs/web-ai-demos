# On-device Gemma with MediaPipe

This demo showcases web performance tips for on-device AI (in-browser). 
It uses the Gemma 2B model, with the [MediaPipe LLM Inference API](https://ai.google.dev/edge/mediapipe/solutions/genai/llm_inference/web_js) (see [npm package](https://www.npmjs.com/package/@mediapipe/tasks-genai)).

It works in Chrome and Edge.

The animation should keep running smoothly without jittering/freezing throughout your session. That's because we've moved both the model preparation steps and the inference work off the main thread, into a dedicated web worker.

Basic worker code is taken from [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Worker).

## Quickstart

- Install: `npm i`
- Run: `npm start`
