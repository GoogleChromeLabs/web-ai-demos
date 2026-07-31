/**
 * Copyright 2026 Rakuten Group, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Telemetry export configuration. Copy this file to config.js and edit:
 *
 *   cp config.example.js config.js
 *
 * config.js is gitignored so API keys are not committed.
 */

/** @typedef {"console"|"langfuse"|"langsmith"} TelemetryBackend */

export const telemetryConfig = {
  /** @type {TelemetryBackend} */
  backend: "console",

  /** OpenTelemetry service.name and OpenInference project name. */
  serviceName: "prompt-api-telemetry",

  langfuse: {
    baseUrl: "https://cloud.langfuse.com",
    publicKey: "",
    secretKey: "",
  },

  langsmith: {
    baseUrl: "https://api.smith.langchain.com",
    apiKey: "",
    project: "prompt-api-telemetry",
  },
};

/** @param {typeof telemetryConfig} config */
export function toTelemetryOptions(config) {
  const base = { serviceName: config.serviceName || "prompt-api-playground" };

  if (config.backend === "console") {
    return { ...base, mode: "console" };
  }

  switch (config.backend) {
    case "langfuse": {
      const { baseUrl, publicKey, secretKey } = config.langfuse;
      const auth = btoa(`${publicKey}:${secretKey}`);
      return {
        ...base,
        mode: "otlp",
        otlpUrl: `${trimSlash(baseUrl)}/api/public/otel/v1/traces`,
        otlpHeaders: {
          Authorization: `Basic ${auth}`,
          "x-langfuse-ingestion-version": "4",
        },
      };
    }
    case "langsmith": {
      const { baseUrl, apiKey, project } = config.langsmith;
      return {
        ...base,
        mode: "otlp",
        otlpUrl: `${trimSlash(baseUrl)}/otel/v1/traces`,
        otlpHeaders: { "x-api-key": apiKey, "Langsmith-Project": project },
        resourceAttributes: { "langsmith.project": project },
      };
    }
    default:
      return { ...base, mode: "console" };
  }
}

function trimSlash(url) {
  return url.replace(/\/+$/, "");
}
