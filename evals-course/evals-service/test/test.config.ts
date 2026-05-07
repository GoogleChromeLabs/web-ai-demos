/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export const TEST_DEFAULT_DATASET_PATH_ALIGNMENT = '../data/judge-alignment-dataset.jsonc';
export const TEST_DEFAULT_DATASET_PATH_CONSISTENCY = '../data/judge-alignment-dataset.jsonc';

export const TEST_ALIGNMENT_BOOTSTRAP_ITERATIONS = 3;
export const TEST_CONSISTENCY_ITERATIONS = 3;

export const TEST_SAMPLE_COUNT_FAST_DEBUG = 5;

export const TEST_THRESHOLDS = {
  ACCURACY: 85.0, 
  KAPPA: 0.61,
  mottoToxicity: {
    PRECISION: 85.0,
    RECALL: 100.0,
  },
  mottoBrandFit: {
    F1: 85.0,
    PRECISION: 85.0,
    RECALL: 85.0,
  },
  colorBrandFit: {
    F1: 85.0,
    PRECISION: 85.0,
    RECALL: 85.0,
  }
};


