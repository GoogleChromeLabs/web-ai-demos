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
} from 'firebase/ai';
import PolyfillBackend from './base.js';
import { DEFAULT_MODELS } from './defaults.js';

/**
 * Firebase AI Logic Backend
 */
export default class FirebaseBackend extends PolyfillBackend {
  #model;

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
    this.ai = getAI(app, {
      backend,
      useLimitedUseAppCheckTokens: useLimitedUseAppCheckTokens || true,
    });
  }

  createSession(_options, sessionParams) {
    this.#model = getGenerativeModel(this.ai, {
      mode: InferenceMode.ONLY_IN_CLOUD,
      inCloudParams: sessionParams,
    });
    return this.#model;
  }

  async generateContent(contents) {
    const result = await this.#model.generateContent({ contents });
    const usage = result.response.usageMetadata?.promptTokenCount || 0;
    return { text: result.response.text(), usage };
  }

  async generateContentStream(contents) {
    const result = await this.#model.generateContentStream({ contents });
    return result.stream;
  }

  async countTokens(contents) {
    const { totalTokens } = await this.#model.countTokens({
      contents,
    });
    return totalTokens;
  }
}
