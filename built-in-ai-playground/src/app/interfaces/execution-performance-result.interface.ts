/**
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
export interface ExecutionPerformanceResultInterface {
  startedExecutionAt: number;
  firstResponseIn: number;
  elapsedTime: number;
  totalExecutionTime: number;
  firstResponseNumberOfWords: number;
  totalNumberOfWords: number;
}
