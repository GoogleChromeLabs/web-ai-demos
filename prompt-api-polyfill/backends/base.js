/**
 * Abstract class representing a backend for the LanguageModel polyfill.
 */
export default class PolyfillBackend {
  #model;

  /**
   * @param {string} modelName - The name of the model.
   */
  constructor(modelName) {
    this.modelName = modelName;
  }

  /**
   * Checks if the backend is available given the options.
   * @param {Object} options - LanguageModel options.
   * @returns {string} 'available', 'unavailable', 'downloadable', or 'downloading'.
   */
  static availability(options) {
    return 'available';
  }

  /**
   * Creates a model session and stores it.
   * @param {Object} options - LanguageModel options.
   * @param {Object} sessionParams - Parameters for the cloud or local model.
   * @param {Object} monitorTarget - Object to report download progress to.
   * @returns {any} The created session object.
   */
  createSession(options, sessionParams, monitorTarget) {
    throw new Error('Not implemented');
  }

  /**
   * Generates content (non-streaming).
   * @param {Array} content - The history + new message content.
   * @returns {Promise<{text: string, usage: number}>}
   */
  async generateContent(content) {
    throw new Error('Not implemented');
  }

  /**
   * Generates content stream.
   * @param {Array} content - The history + new content.
   * @returns {Promise<AsyncIterable>} Stream of chunks.
   */
  async generateContentStream(content) {
    throw new Error('Not implemented');
  }

  /**
   * Counts tokens.
   * @param {Array} content - The content to count.
   * @returns {Promise<number>} Total tokens.
   */
  async countTokens(content) {
    throw new Error('Not implemented');
  }
}
