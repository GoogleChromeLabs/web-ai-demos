/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
export interface PromptInterface<T> {
  content: string;

  role: T;
}
