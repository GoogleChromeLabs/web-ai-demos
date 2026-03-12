/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp } from 'firebase/app';
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
} from 'firebase/app-check';
import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  VertexAIBackend,
  InferenceMode,
  Schema,
} from 'firebase/ai';
import PolyfillBackend from './base.js';
import { DEFAULT_MODELS } from './defaults.js';

/**
 * Converts a standard JSON Schema object into a Firebase Vertex AI Schema class instance.
 * @param {Object} jsonSchema - The standard JSON Schema object.
 * @returns {Schema} - The Firebase Vertex AI Schema instance.
 */
function convertJsonSchemaToVertexSchema(jsonSchema) {
  if (!jsonSchema) {
    return undefined;
  }

  // Extract common base parameters supported by all Schema types
  const baseParams = {
    description: jsonSchema.description,
    nullable: jsonSchema.nullable || false,
    format: jsonSchema.format,
  };

  // Handle "type": ["string", "null"] pattern common in JSON Schema
  if (Array.isArray(jsonSchema.type) && jsonSchema.type.includes('null')) {
    baseParams.nullable = true;
    jsonSchema.type = jsonSchema.type.find((t) => t !== 'null');
  }

  // Switch based on schema type
  switch (jsonSchema.type) {
    case 'string':
      // Check for Enums
      if (jsonSchema.enum && Array.isArray(jsonSchema.enum)) {
        return Schema.enumString({
          ...baseParams,
          enum: jsonSchema.enum,
        });
      }
      return Schema.string(baseParams);

    case 'number':
      return Schema.number(baseParams);

    case 'integer':
      return Schema.integer(baseParams);

    case 'boolean':
      return Schema.boolean(baseParams);

    case 'array':
      return Schema.array({
        ...baseParams,
        // Recursively convert the 'items' schema
        items: convertJsonSchemaToVertexSchema(jsonSchema.items),
      });

    case 'object': {
      const properties = {};
      const allPropertyKeys = jsonSchema.properties
        ? Object.keys(jsonSchema.properties)
        : [];

      // Recursively convert each property
      allPropertyKeys.forEach((key) => {
        properties[key] = convertJsonSchemaToVertexSchema(
          jsonSchema.properties[key]
        );
      });

      // Calculate optionalProperties
      // JSON Schema uses "required" (allowlist), Vertex SDK uses "optionalProperties" (blocklist)
      const required = jsonSchema.required || [];
      const optionalProperties = allPropertyKeys.filter(
        (key) => !required.includes(key)
      );

      return Schema.object({
        ...baseParams,
        properties: properties,
        optionalProperties: optionalProperties,
      });
    }

    default:
      // Fallback for unknown types or complex types not fully supported (like oneOf)
      // defaulting to string usually prevents crashes, but use with caution.
      console.warn(
        `Unsupported type: ${jsonSchema.type}, defaulting to string.`
      );
      return Schema.string(baseParams);
  }
}

/**
 * Firebase AI Logic Backend
 */
export default class FirebaseBackend extends PolyfillBackend {
  #model;
  #ai;

  constructor(config) {
    const {
      geminiApiProvider,
      modelName,
      useAppCheck,
      reCaptchaSiteKey,
      useLimitedUseAppCheckTokens,
      ...firebaseConfig
    } = config;
    super(modelName || DEFAULT_MODELS.firebase.modelName);
    const app = initializeApp(firebaseConfig);
    if (useAppCheck && reCaptchaSiteKey) {
      initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(reCaptchaSiteKey),
        isTokenAutoRefreshEnabled: true,
      });
    }
    const backend =
      geminiApiProvider === 'vertex'
        ? new VertexAIBackend()
        : new GoogleAIBackend();
    this.#ai = getAI(app, {
      backend,
      useLimitedUseAppCheckTokens: useLimitedUseAppCheckTokens || true,
    });
  }

  /**
   * Translates a standard JSON Schema into a backend-specific format.
   * @param {Object} schema - The standard JSON Schema.
   * @returns {any} The backend-specific schema.
   */
  convertSchema(schema) {
    return convertJsonSchemaToVertexSchema(schema);
  }

  /**
   * Creates a model session and stores it.
   * @param {Object} _options - LanguageModel options.
   * @param {Object} sessionParams - Parameters for the cloud or local model.
   * @returns {any} The created session object.
   */
  createSession(_options, sessionParams) {
    this.#model = getGenerativeModel(this.#ai, {
      mode: InferenceMode.ONLY_IN_CLOUD,
      inCloudParams: sessionParams,
    });
    return this.#model;
  }

  /**
   * Generates content (non-streaming).
   * @param {Array} contents - The history + new message content.
   * @returns {Promise<{text: string, usage: number}>}
   */
  async generateContent(contents) {
    const result = await this.#model.generateContent({ contents });
    const usage = result.response.usageMetadata?.promptTokenCount || 0;
    return { text: result.response.text(), usage };
  }

  /**
   * Generates content stream.
   * @param {Array} contents - The history + new content.
   * @returns {Promise<AsyncIterable>} Stream of chunks.
   */
  async generateContentStream(contents) {
    const result = await this.#model.generateContentStream({ contents });
    return result.stream;
  }

  /**
   * Counts tokens.
   * @param {Array} contents - The content to count.
   * @returns {Promise<number>} Total tokens.
   */
  async countTokens(contents) {
    const { totalTokens } = await this.#model.countTokens({
      contents,
    });
    return totalTokens;
  }
}
