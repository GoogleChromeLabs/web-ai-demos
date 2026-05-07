/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as dotenv from 'dotenv';
dotenv.config({ quiet: true });
import { evalAll } from '../src/eval.service';
import { JUDGE_MODEL } from '../src/app.config';
import { Mismatch } from '../src/types';
import {
  computeBasicAlignmentStats,
  extractItemsToEval, mapHumanLabelsById, logProgress,
  getFilePath, loadDataset
  , styleAccuracy,
  calculatePercentage
} from './utils.test';
import { TEST_DEFAULT_DATASET_PATH_ALIGNMENT, TEST_SAMPLE_COUNT_FAST_DEBUG } from './test.config';

// Single pass, basic variation (alignment % only)

// --- Main execution ---

async function run() {
  // Load dataset and prepare test cases
  const datasetPath = getFilePath(__dirname, TEST_DEFAULT_DATASET_PATH_ALIGNMENT);
  logTestStart(datasetPath);
  const dataset = loadDataset(datasetPath);
  let samplesToEvaluate = extractItemsToEval(dataset);
  // Fast mode, use only for debugging this judge alignment script (SAMPLE_COUNT_FAST is not a statistically significant sample size)
  const isFast = process.argv.includes('--fast');
  if (isFast) {
    console.log(`\x1b[33m⚠️⚡️ Using FAST MODE. Use this mode only for debugging your evals suite itself. Evaluating only ${TEST_SAMPLE_COUNT_FAST_DEBUG} samples out of the ${samplesToEvaluate.length} available.\x1b[0m\n`);
    samplesToEvaluate = samplesToEvaluate.slice(0, TEST_SAMPLE_COUNT_FAST_DEBUG);
  }
  const sampleCount = samplesToEvaluate.length;

  // Map human labels by ID for quick lookup
  const humanLabelsMap = mapHumanLabelsById(dataset);

  // Log evaluation start
  // 3 checks per sample (mottoToxicity, mottoBrandFit, colorBrandFit)
  logJudgeStart(sampleCount * 3, process.env.JUDGE_MODEL || JUDGE_MODEL);
  const startTime = Date.now();

  // Evaluate and log results
  logProgress(startTime, 0, sampleCount);
  const evalResponse = await evalAll(samplesToEvaluate, {
    onProgress: (current, total) => logProgress(startTime, current, total)
  });
  const { mismatches, totalSampleCount, alignedSampleCount } =
    computeBasicAlignmentStats(evalResponse.results, humanLabelsMap);
  logMismatches(mismatches);
  const alignment = calculatePercentage(alignedSampleCount, totalSampleCount);

  console.log("\nTEST DONE!");
  console.log(`📊 RESULTS:`);
  console.log(`  Accuracy: ${styleAccuracy(alignment)} (${alignedSampleCount}/${totalSampleCount})`);
}

run().catch(console.error);

// --- Logging ---

function logTestStart(filePath: string) {
  console.log("\n\n========================================");
  console.log("TEST: judge-human alignment (BASIC)");
  console.log("========================================");
  console.log("Goal: Test that the LLM judge is aligned with human evaluations (alignment% only).\n");
  console.log("⚠️ WARNING: alignment% (accuracy) is a basic metric.");
  console.log("It does not account for random chance or class imbalance, and cannot distinguish between false positives and false negatives.\n");
  console.log(`Using dataset: ${filePath}`);
}

function logJudgeStart(totalApiCallsExpected: number, model: string) {
  console.log(`Using LLM judge (${model} with custom prompt). Total API calls expected: ${totalApiCallsExpected}.\n`);
}

function logMismatches(mismatches: Mismatch[]) {
  console.log("\n❌ MISMATCHES:\n");
  for (const mismatch of mismatches) {
    console.log(`• [${mismatch.id}] ${mismatch.evalCriterion} mismatch: Human expected ${mismatch.humanLabel}, but LLM output ${mismatch.llmLabel}`);
    console.log(`   LLM rationale: ${mismatch.llmRationale}`);
    console.log(`   Human rationale: ${mismatch.humanRationale}\n`);
  }
}

// removed logFinalResults as it is now inlined function in run()
