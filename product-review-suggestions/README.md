# Product review suggestions

## Why this demo

Online stores can see a **270%** increase in conversions by showing product reviews ([Source](https://spiegel.medill.northwestern.edu/wp-content/uploads/sites/2/2021/04/Spiegel_Online-Review_eBook_Jun2017_FINAL.pdf)). Negative reviews are key, as they build credibility: 82% of online shoppers look for them before buying ([Source](https://spiegel.medill.northwestern.edu/wp-content/uploads/sites/2/2021/04/Spiegel_Online-Review_eBook_Jun2017_FINAL.pdf)).

Writing a helpful product review, especially a negative one, can be tricky. In this demo, we use Gen AI (an LLM) to help users write informative reviews that will aid others' purchasing decisions.

<p align="center">
  <img src="https://github.com/user-attachments/assets/f81ed907-93c3-4adf-90de-ad68db06f53c" width="400"/>
</p>

## Quickstart

- Install: `npm i`
- Run: `npm start`

## Browser support and prerequisites

Because the MediaPipe LLM Inference API relies on WebGPU, this demo runs in all browsers that support WebGPU. As of August 2024:

- Chrome
- Edge
- Firefox Nightly ⚠️ Turn on the flag `dom.webgpu.workers.enabled` in `about:config`
- Safari Technology Preview

## Implementation details

**This demo uses client-side AI (in-browser).**

- This demo uses the Gemma 2B model, with the [MediaPipe LLM Inference API](https://ai.google.dev/edge/mediapipe/solutions/genai/llm_inference/web_js) (see [npm package](https://www.npmjs.com/package/@mediapipe/tasks-genai)).
- This demo uses a worker to free up the main thread. It also includes an implementation of message passing between the worker and the main thread, to display model readiness status updates to the user.

## Sources

Basic worker code is taken from [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Worker).
