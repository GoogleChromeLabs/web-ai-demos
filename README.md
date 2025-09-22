DefenБ# Collection of client-side AI demos

This repository contains demos related to client-side (in-browser) AI.

## List of demos

Some of these demos use [Chrome built-in AI](https://developer.chrome.com/docs/ai/built-in). 
Others showcase generic client-side AI using Transformers.js or Google's Gemma model through MediaPipe.

- `weather-ai`: Uses Chrome's built-in Prompt API to generate a human-readable description of the weather from structured weather data provided by the OpenWeatherMap API.
- `prompt-api-playground`: Showcases Chrome's built-in experimental Prompt API.
- `summarization-api-playground`: Showcases Chrome's built-in experimental Summarization API.
- `perf-client-side-gemma-worker`: Showcases web performance/UX tips for client-side Gen AI, based on a web worker. Uses an LLM (Google's Gemma 2) through MediaPipe.
- `right-click-for-superpowers`: Shows how to add utility to a webpage utilizing an LLM (Google's Gemma 2B) to perform common useful tasks like summarisation, translation, or defining words or phrases in a manner that is then easier to understand.
- `product-reviews`: Includes client-side sentiment analysis, toxicity, and rating assesment of a product review. Showcased at I/O 2024. Uses an LLM (Google's Gemma 2B) through MediaPipe, and toxicity models from Transformers.js.
- `gemini-node-sse`: Shows how to use Server Sent Events (SSE) to stream content from Gemini, using Node.js and the Google AI SDK for JavaScript to a web application.
