/**
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ReadableStream } from "stream/web";

export {};

declare global {
    interface WindowOrWorkerGlobalScope {
        readonly ai: AI;
    }

    interface AI {
        readonly assistant: AIAssistantFactory;
    }

    interface AICreateMonitor extends EventTarget {
        ondownloadprogress: ((this: AICreateMonitor, ev: DownloadProgressEvent) => any) | null;

        addEventListener<K extends keyof AICreateMonitorEventMap>(
            type: K,
            listener: (this: AICreateMonitor, ev: AICreateMonitorEventMap[K]) => any,
            options?: boolean | AddEventListenerOptions,
        ): void;
        addEventListener(
            type: string,
            listener: EventListenerOrEventListenerObject,
            options?: boolean | AddEventListenerOptions,
        ): void;
        removeEventListener<K extends keyof AICreateMonitorEventMap>(
            type: K,
            listener: (this: AICreateMonitor, ev: AICreateMonitorEventMap[K]) => any,
            options?: boolean | EventListenerOptions,
        ): void;
        removeEventListener(
            type: string,
            listener: EventListenerOrEventListenerObject,
            options?: boolean | EventListenerOptions,
        ): void;
    }

    interface DownloadProgressEvent extends Event {
        readonly loaded: number;
        readonly total: number;
    }

    interface AICreateMonitorEventMap {
        downloadprogress: DownloadProgressEvent;
    }

    type AICreateMonitorCallback = (monitor: AICreateMonitor) => void;

    type AICapabilityAvailability = "readily" | "after-download" | "no";

    // Assistant
    // https://github.com/explainers-by-googlers/prompt-api/#full-api-surface-in-web-idl

    interface AIAssistantFactory {
        create(
            options?: AIAssistantCreateOptionsWithSystemPrompt | AIAssistantCreateOptionsWithoutSystemPrompt,
        ): Promise<AIAssistant>;
        capabilities(): Promise<AIAssistantCapabilities>;
    }

    interface AIAssistantCreateOptions {
        signal?: AbortSignal;
        monitor?: AICreateMonitorCallback;

        topK?: number;
        temperature?: number;
    }

    interface AIAssistantCreateOptionsWithSystemPrompt extends AIAssistantCreateOptions {
        systemPrompt?: string;
        initialPrompts?: Array<AIAssistantAssistantPrompt | AIAssistantUserPrompt>;
    }

    interface AIAssistantCreateOptionsWithoutSystemPrompt extends AIAssistantCreateOptions {
        systemPrompt?: never;
        initialPrompts?:
            | [AIAssistantSystemPrompt, ...Array<AIAssistantAssistantPrompt | AIAssistantUserPrompt>]
            | Array<AIAssistantAssistantPrompt | AIAssistantUserPrompt>;
    }

    type AIAssistantPromptRole = "system" | "user" | "assistant";

    interface AIAssistantPrompt {
        role?: AIAssistantPromptRole;
        content?: string;
    }

    interface AIAssistantSystemPrompt extends AIAssistantPrompt {
        role: "system";
    }

    interface AIAssistantUserPrompt extends AIAssistantPrompt {
        role: "user";
    }

    interface AIAssistantAssistantPrompt extends AIAssistantPrompt {
        role: "assistant";
    }

    interface AIAssistant extends EventTarget {
        prompt(input: string, options?: AIAssistantPromptOptions): Promise<string>;
        promptStreaming(input: string, options?: AIAssistantPromptOptions): ReadableStream<string>;

        countPromptTokens(input: string, options?: AIAssistantPromptOptions): Promise<number>;
        readonly maxTokens: number;
        readonly tokensSoFar: number;
        readonly tokensLeft: number;

        readonly topK: number;
        readonly temperature: number;

        oncontextoverflow: ((this: AIAssistant, ev: Event) => any) | null;

        addEventListener<K extends keyof AIAssistantEventMap>(
            type: K,
            listener: (this: AIAssistant, ev: AIAssistantEventMap[K]) => any,
            options?: boolean | AddEventListenerOptions,
        ): void;
        addEventListener(
            type: string,
            listener: EventListenerOrEventListenerObject,
            options?: boolean | AddEventListenerOptions,
        ): void;
        removeEventListener<K extends keyof AIAssistantEventMap>(
            type: K,
            listener: (this: AIAssistant, ev: AIAssistantEventMap[K]) => any,
            options?: boolean | EventListenerOptions,
        ): void;
        removeEventListener(
            type: string,
            listener: EventListenerOrEventListenerObject,
            options?: boolean | EventListenerOptions,
        ): void;

        clone(): Promise<AIAssistant>;
        destroy(): void;
    }

    interface AIAssistantEventMap {
        contextoverflow: Event;
    }

    interface AIAssistantPromptOptions {
        signal?: AbortSignal;
    }

    interface AIAssistantCapabilities {
        readonly available: AICapabilityAvailability;

        readonly defaultTopK: number | null;
        readonly maxTopK: number | null;
        readonly defaultTemperature: number | null;

        supportsLanguage(languageTag: Intl.UnicodeBCP47LocaleIdentifier): AICapabilityAvailability;
    }
}