# Prompt API Telemetry

Observability PoC for Chrome's Prompt API — a standalone demo based on [`prompt-api-playground`](../prompt-api-playground).

## Motivation

Teams shipping server-side GenAI products already rely on OpenTelemetry-based observability stacks to observe real behavior, evaluate, diagnose and implement an improvement loop.

Built-in AI runs in the browser with no backend. The same observability stacks do not apply out of the box, which is a practical blocker for moving from demos to production. Without traces, teams cannot close the loop on prompt quality, latency, or failures for on-device inference.

This PoC shows that **we can instrument Chrome's Prompt API in the client and export [OpenInference](https://arize-ai.github.io/openinference/spec/) traces to the same backends used for server-side GenAI services**. It is an early step toward observability parity between built-in AI and traditional GenAI — not a production-ready SDK.

## What this is

A copy of the Prompt API playground with OpenTelemetry instrumentation added. Export traces directly to an OpenTelemetry backend like Langfuse or LangSmith via OTLP/HTTP JSON.

There is no app backend. Run it with `npm start`. The chat UI matches the playground — observability is layered on with minimal extra code.

## Changes vs prompt-api-playground

| File | Change |
| ---- | ------ |
| `script.js` | Imports `telemetry.js` + `config.js`; calls `initTelemetry()` on load; replaces `LanguageModel.create()` with `createInstrumentedSession()` |
| `index.html` | Adds an OpenTelemetry import map in `<head>` (loads SDK from esm.sh) |
| `telemetry.js` | **New.** OpenTelemetry setup, OTLP/console export, Prompt API span instrumentation |
| `config.example.js` | **New.** Template for backend + credentials — copy to `config.js` |
| `.gitignore` | **New.** Ignores `config.js` |

Suggested review order: this README → `script.js` (diff vs playground) → `index.html` (import map only) → `config.example.js` → `telemetry.js` (core).

## Setup

```bash
cd prompt-api-telemetry
cp config.example.js config.js   # first time only — the app won't load without config.js
npm start                        # or: npx http-server
```

Edit `config.js`:

1. Set `backend` to `"langfuse"`, `"langsmith"`, or `"console"`
2. Fill in the credentials for your chosen backend
3. Reload the page

Use `backend: "console"` to print spans to DevTools without exporting to an OpenTelemetry backend.

`config.js` is gitignored — **never commit API keys**.

## What gets traced

| Span | Kind | When |
| ---- | ---- | ---- |
| `LanguageModel.create` | CHAIN | Session start — assigns a `session.id` |
| `LanguageModel.promptStreaming` | LLM | Each prompt (streaming) |
| `LanguageModel.destroy` | CHAIN | Session reset |

Spans use [OpenInference](https://arize-ai.github.io/openinference/spec/) attributes: `llm.input_messages`, `llm.output_messages`, `llm.token_count.*`, `session.id` (groups turns into a thread), and `llm.time_to_first_token_ms`.

## Future work

### Client-safe credentials (prerequisite for next phase)

This PoC puts full API keys in `config.js`. That is acceptable for a local developer setup, but **not** for shipping observability in a public client. Moving beyond PoC requires a credential that is safe to embed in frontend code — something like a scoped ingestion token with trace-export-only permissions, analogous to a Measurement ID in analytics stacks (public, narrow scope, no account access). Observability providers would need to offer this kind of client-safe credential, or document a supported proxy that holds the secret server-side.

### Typed npm SDK

Publish a typed npm package that bundles OpenTelemetry setup, backend config, and Prompt API instrumentation — so developers add a dependency instead of copying `telemetry.js` or wiring an esm.sh import map.

### Other built-in AI APIs

Extend instrumentation to the other [Chrome built-in AI APIs](https://developer.chrome.com/docs/ai/built-in-apis): Summarizer, Translator, Language Detector, Writer, Rewriter, and Proofreader.
