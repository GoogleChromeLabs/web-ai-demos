/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ReadableStream } from "stream/web";

export {};

declare global {
  type AIModelAvailability = 'readily' |  'after-download' | 'no';
  type AITextSessionOptions = {
    temperature: number,
    topK: number,
  }

  type AITextSession = {
    promptStreaming: (string) => Promise<ReadableStream<string>>,
    prompt: (string) => Promise<string>,
    destroy: () => void;
    clone: () => AITextSession;
  }

  interface Window {
    ai: {
      defaultTextSessionOptions: () => Promise<AITextSessionOptions>,
      canCreateTextSession: () => Promise<AIModelAvailability>,
      createTextSession: (options?: AITextSessionOptions) => Promise<AITextSession>,
    };
  }
}
