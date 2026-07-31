/**
 * Copyright 2026 Rakuten Group, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * OpenTelemetry instrumentation for the Prompt API playground.
 *
 * Spans follow OpenInference conventions and are exported directly from the browser to an OpenTelemetry Backend via OTLP/HTTP JSON.
 */

import {
  trace,
  context,
  SpanStatusCode,
  SpanKind,
} from "@opentelemetry/api";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchSpanProcessor,
  SimpleSpanProcessor,
  ConsoleSpanExporter,
} from "@opentelemetry/sdk-trace-base";
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

const OI = {
  SPAN_KIND: "openinference.span.kind",
  INPUT_VALUE: "input.value",
  INPUT_MIME: "input.mime_type",
  OUTPUT_VALUE: "output.value",
  OUTPUT_MIME: "output.mime_type",
  LLM_SYSTEM: "llm.system",
  LLM_PROVIDER: "llm.provider",
  LLM_MODEL: "llm.model_name",
  LLM_TOKEN_PROMPT: "llm.token_count.prompt",
  LLM_TOKEN_COMPLETION: "llm.token_count.completion",
  LLM_TOKEN_TOTAL: "llm.token_count.total",
  SESSION_ID: "session.id",
};

const OI_KIND = { LLM: "LLM", CHAIN: "CHAIN" };

const MODEL = {
  system: "chrome-built-in-ai",
  provider: "google",
  model: "gemini-nano",
};

const TRACER_NAME = "prompt-api-telemetry";
const TRACER_VERSION = "0.1.0";

let currentProvider = null;
let tracer = trace.getTracer(TRACER_NAME, TRACER_VERSION);

function flattenMessages(prefix, messages) {
  const attrs = {};
  messages.forEach((msg, i) => {
    attrs[`${prefix}.${i}.message.role`] = msg.role;
    attrs[`${prefix}.${i}.message.content`] =
      typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
  });
  return attrs;
}

/** @param {{ mode?: "console"|"otlp", serviceName?: string, otlpUrl?: string, otlpHeaders?: Record<string,string>, resourceAttributes?: Record<string,string> }} opts */
export async function initTelemetry(opts = {}) {
  const {
    mode = "otlp",
    serviceName = "prompt-api-playground",
    otlpUrl,
    otlpHeaders,
    resourceAttributes,
  } = opts;

  if (currentProvider) {
    try {
      await currentProvider.shutdown();
    } catch (err) {
      console.warn("[telemetry] shutdown failed:", err);
    }
    currentProvider = null;
  }

  const spanProcessors = [];
  if (mode === "console") {
    spanProcessors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()));
  } else if (mode === "otlp") {
    if (!otlpUrl) throw new Error("initTelemetry: otlpUrl required");
    spanProcessors.push(
      new BatchSpanProcessor(new OTLPTraceExporter({ url: otlpUrl, headers: otlpHeaders ?? {} }))
    );
  }

  const provider = new WebTracerProvider({
    resource: resourceFromAttributes({
      "service.name": serviceName,
      "openinference.project.name": serviceName,
      ...(resourceAttributes ?? {}),
    }),
    spanProcessors,
  });

  provider.register();
  currentProvider = provider;
  tracer = provider.getTracer(TRACER_NAME, TRACER_VERSION);

  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") provider.forceFlush();
  });
  window.addEventListener("beforeunload", () => provider.forceFlush());

  return provider;
}

export async function flushTelemetry() {
  if (!currentProvider) return;
  try {
    await currentProvider.forceFlush();
  } catch (err) {
    console.warn("[telemetry] forceFlush failed:", err);
  }
}

export async function createInstrumentedSession(options = {}) {
  return tracer.startActiveSpan(
    "LanguageModel.create",
    { kind: SpanKind.CLIENT },
    async (span) => {
      const sessionId = crypto.randomUUID();
      const initialPrompts = options.initialPrompts ?? [];
      const systemPrompt = initialPrompts.find((p) => p.role === "system")?.content;

      span.setAttributes({
        [OI.SPAN_KIND]: OI_KIND.CHAIN,
        [OI.SESSION_ID]: sessionId,
        [OI.LLM_SYSTEM]: MODEL.system,
        [OI.LLM_PROVIDER]: MODEL.provider,
        [OI.LLM_MODEL]: MODEL.model,
        [OI.INPUT_VALUE]: JSON.stringify(options),
        [OI.INPUT_MIME]: "application/json",
      });
      if (systemPrompt) span.setAttribute("session.system_prompt", systemPrompt);

      try {
        const session = await LanguageModel.create(options);
        span.setAttributes({
          "session.context_window": session.contextWindow ?? session.inputQuota ?? 0,
        });
        span.setStatus({ code: SpanStatusCode.OK });
        return wrapSession(session, { sessionId, systemPrompt });
      } catch (err) {
        span.recordException(err);
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(err?.message ?? err) });
        throw err;
      } finally {
        span.end();
      }
    }
  );
}

function wrapSession(session, meta) {
  const state = { ...meta, turnIndex: 0 };
  return new Proxy(session, {
    get(target, prop, receiver) {
      if (prop === "prompt") return (input, opts) => tracedPrompt(target, state, input, opts);
      if (prop === "promptStreaming") {
        return (input, opts) => tracedPromptStreaming(target, state, input, opts);
      }
      if (prop === "destroy") {
        return () => {
          try {
            return target.destroy();
          } finally {
            const span = tracer.startSpan("LanguageModel.destroy");
            span.setAttributes({ [OI.SPAN_KIND]: OI_KIND.CHAIN, [OI.SESSION_ID]: state.sessionId });
            span.end();
          }
        };
      }
      // Native getters (contextWindow, contextUsage, …) require the real session
      // as `this`. Using the Proxy as receiver causes "Illegal invocation".
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

async function tracedPrompt(session, state, input, opts) {
  state.turnIndex += 1;
  return tracer.startActiveSpan(
    "LanguageModel.prompt",
    { kind: SpanKind.CLIENT },
    async (span) => {
      const messages = buildMessages(state.systemPrompt, input);
      const tokensBefore = readContextUsage(session);

      span.setAttributes({
        [OI.SPAN_KIND]: OI_KIND.LLM,
        [OI.SESSION_ID]: state.sessionId,
        [OI.LLM_SYSTEM]: MODEL.system,
        [OI.LLM_PROVIDER]: MODEL.provider,
        [OI.LLM_MODEL]: MODEL.model,
        [OI.INPUT_VALUE]: typeof input === "string" ? input : JSON.stringify(input),
        [OI.INPUT_MIME]: typeof input === "string" ? "text/plain" : "application/json",
        "llm.turn_index": state.turnIndex,
        ...flattenMessages("llm.input_messages", messages),
      });

      try {
        const result = await session.prompt(input, opts);
        const tokensAfter = readContextUsage(session);
        span.setAttributes({
          [OI.OUTPUT_VALUE]: result,
          [OI.OUTPUT_MIME]: "text/plain",
          ...flattenMessages("llm.output_messages", [{ role: "assistant", content: result }]),
          ...tokenAttrs(tokensBefore, tokensAfter),
        });
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (err) {
        span.recordException(err);
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(err?.message ?? err) });
        throw err;
      } finally {
        span.end();
      }
    }
  );
}

function tracedPromptStreaming(session, state, input, opts) {
  state.turnIndex += 1;
  const messages = buildMessages(state.systemPrompt, input);
  const tokensBefore = readContextUsage(session);

  const span = tracer.startSpan("LanguageModel.promptStreaming", { kind: SpanKind.CLIENT }, context.active());
  span.setAttributes({
    [OI.SPAN_KIND]: OI_KIND.LLM,
    [OI.SESSION_ID]: state.sessionId,
    [OI.LLM_SYSTEM]: MODEL.system,
    [OI.LLM_PROVIDER]: MODEL.provider,
    [OI.LLM_MODEL]: MODEL.model,
    [OI.INPUT_VALUE]: typeof input === "string" ? input : JSON.stringify(input),
    [OI.INPUT_MIME]: typeof input === "string" ? "text/plain" : "application/json",
    "llm.turn_index": state.turnIndex,
    "llm.streaming": true,
    ...flattenMessages("llm.input_messages", messages),
  });

  let underlying;
  try {
    underlying = session.promptStreaming(input, opts);
  } catch (err) {
    span.recordException(err);
    span.setStatus({ code: SpanStatusCode.ERROR, message: String(err?.message ?? err) });
    span.end();
    throw err;
  }

  const startedAt = performance.now();
  let firstChunkAt = null;
  let chunkCount = 0;
  let fullText = "";
  let previousChunk = "";

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of underlying) {
          chunkCount += 1;
          if (firstChunkAt === null) {
            firstChunkAt = performance.now();
            span.addEvent("llm.first_token", {
              "llm.time_to_first_token_ms": firstChunkAt - startedAt,
            });
          }
          const delta = chunk.startsWith(previousChunk) ? chunk.slice(previousChunk.length) : chunk;
          fullText += delta;
          previousChunk = chunk;
          controller.enqueue(chunk);
        }
        span.setAttributes({
          [OI.OUTPUT_VALUE]: fullText,
          [OI.OUTPUT_MIME]: "text/plain",
          "llm.chunk_count": chunkCount,
          "llm.duration_ms": performance.now() - startedAt,
          ...flattenMessages("llm.output_messages", [{ role: "assistant", content: fullText }]),
          ...tokenAttrs(tokensBefore, readContextUsage(session)),
        });
        span.setStatus({ code: SpanStatusCode.OK });
        controller.close();
      } catch (err) {
        span.recordException(err);
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(err?.message ?? err) });
        controller.error(err);
      } finally {
        span.end();
      }
    },
  });
}

function buildMessages(systemPrompt, input) {
  const messages = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  if (typeof input === "string") messages.push({ role: "user", content: input });
  else if (Array.isArray(input)) messages.push(...input);
  else if (input && typeof input === "object") messages.push(input);
  return messages;
}

function readContextUsage(session) {
  return session.contextUsage ?? session.inputUsage ?? session.tokensSoFar ?? 0;
}

function tokenAttrs(before, after) {
  const total = Math.max(0, Math.round(after));
  const delta = Math.max(0, Math.round(after - before));
  return {
    [OI.LLM_TOKEN_TOTAL]: total,
    [OI.LLM_TOKEN_PROMPT]: Math.max(0, Math.round(before)),
    [OI.LLM_TOKEN_COMPLETION]: delta,
  };
}
