/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export {};

declare global {
  type AIModelAvailability = 'readily' |  'after-download' | 'no';
  type AISummarizerType = 'tl;dr' | 'key-points' | 'teaser' | 'headline';
  type AISummarizerFormat = 'plain-text' | 'markdown';
  type AISummarizerLength = 'short' | 'medium' | 'long' ;

  type AISummarizerCreateOptions = {
    type?: AISummarizerType,
    length?: AISummarizerLength,
    format?: AISummarizerFormat,
  };

  type AISummarizer = {
    capabilities: () => Promise<AISummarizerCapabilities>;
    create: (options?: AISummarizerCreateOptions) => Promise<AISummarizerSession>;
  }

  type AISummarizerCapabilities = {
    available: AIModelAvailability
  }

  type AIModelDownloadProgressEvent = {
    loaded: number,
    total: number,
  }

  type AIModelDownloadCallback = (string, AIModelDownloadProgressEvent) => void;

  type AISummarizerSession = {
    destroy: () => void;
    ready: Promise<void>;
    summarize: (string) => Promise<string>;
    addEventListener: AIModelDownloadCallback;
  }

  interface Window {
    ai: {
      summarizer?: AISummarizer
    };
  }
}