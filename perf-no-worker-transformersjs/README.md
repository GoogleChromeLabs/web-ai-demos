# Client-side Gemma with Transformers.js without a worker

## Why this demo

* This demo showcases the non-worker pendant of the [toxicity worker demo](https://github.com/GoogleChromeLabs/web-ai-demos/tree/main/perf-client-side-gemma-worker). It shows that not using a worker creates a performance bottleneck: the animation jitters, because the model preparation steps and the inference work take place on the main thread.
* This demo uses Transformers.js.

## Quickstart

- Install: `npm i`
- Run: `npm start`
