# Toxic review warning

Keywords: `Client-side` `Web AI` `Transformers.js` (NOT Chrome built-in)

<p align="center">
  <img src="https://github.com/user-attachments/assets/dca9238e-cf81-461c-aca5-5581cb48b929" width="400"/>
</p>

## Technology and browser support

This demo runs entirely in the browser (= client-side AI = Web AI). It uses Transformers.js. It runs in all browsers that support Transformers.js.

## Why this demo

Online toxicity is an [existential problem for platforms and publishers](https://perspectiveapi.com/). Online abuse [silences](https://www.researchgate.net/figure/After-receiving-a-toxic-comment-users-become-less-active-On-average-users-are-more_fig1_376246924) important voices in conversation. On a business level, toxic comments can damage a brand's image and [drive customers and users away](https://www.nature.com/articles/s41598-024-57783-8).

Here, we use Gen AI (an LLM) to catch toxic comments in real-time. While server-side toxicity screening remains necessary, this approach helps users understand why their comments might be harmful and can reduce the server-side workload.

## Quickstart

- Install: `npm i`
- Run: `npm start`

## Implementation details

- This demo uses Transformers.js.
- This demo uses a worker to free up the main thread. It also includes an implementation of message passing between the worker and the main thread, to display model readiness status updates to the user.

## References

Classifier code is taken from [this transformers.js example](https://github.com/Programming-from-A-to-Z/transformers-js-examples/blob/main/model-demos/sketch.js).
