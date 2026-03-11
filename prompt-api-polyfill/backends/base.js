/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Abstract class representing a backend for the LanguageModel polyfill.
 */
export default class PolyfillBackend {

  /**
   * @param {string} modelName - The name of the model.
   */
  constructor(modelName) {
    this.modelName = modelName;
  }

  /**
   * Checks if the backend is available given the options.
   * @param {Object} _options - LanguageModel options.
   * @returns {string} 'available', 'unavailable', 'downloadable', or 'downloading'.
   */
  static availability(_options) {
    return 'available';
  }

  /**
   * Creates a model session and stores it.
   * @param {Object} _options - LanguageModel options.
   * @param {Object} _sessionParams - Parameters for the cloud or local model.
   * @param {EventTarget} [_monitorTarget] - The event target to dispatch download progress events to.
   * @returns {any} The created session object.
   */
  createSession(_options, _sessionParams, _monitorTarget) {
    throw new Error('Not implemented');
  }

  /**
   * Generates content (non-streaming).
   * @param {Array} _content - The history + new message content.
   * @returns {Promise<{text: string, usage: number}>}
   */
  async generateContent(_content) {
    throw new Error('Not implemented');
  }

  /**
   * Generates content stream.
   * @param {Array} _content - The history + new content.
   * @returns {Promise<AsyncIterable>} Stream of chunks.
   */
  async generateContentStream(_content) {
    throw new Error('Not implemented');
  }

  /**
   * Counts tokens.
   * @param {Array} _content - The content to count.
   * @returns {Promise<number>} Total tokens.
   */
  async countTokens(_content) {
    throw new Error('Not implemented');
  }
  /**
   * Translates a standard JSON Schema into a backend-specific format.
   * @param {Object} schema - The standard JSON Schema.
   * @returns {any} The backend-specific schema.
   */
  convertSchema(schema) {
    return schema;
  }
}
