/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as dotenv from 'dotenv';
dotenv.config({ quiet: true });
import { evalAll } from '../src/eval.service';
import { JUDGE_MODEL } from '../src/app.config';
import { Mismatch, FinalAlignmentResults } from '../src/types';
import {
  computeAlignmentStats, calculateFinalAlignmentResults,
  extractItemsToEval, mapHumanLabelsById, logProgress,
  getFilePath, loadDataset
  , styleAccuracy, styleKappa, stylePrecision, styleRecall, styleF1
} from './utils.test';
import { TEST_DEFAULT_DATASET_PATH_ALIGNMENT, TEST_SAMPLE_COUNT_FAST_DEBUG, TEST_THRESHOLDS } from './test.config';

// Single pass

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
    console.log(`⚡️ Using FAST MODE. Use only for debugging your evals suite itself! Evaluating only ${TEST_SAMPLE_COUNT_FAST_DEBUG} samples out of the ${samplesToEvaluate.length} available.`);
    samplesToEvaluate = samplesToEvaluate.slice(0, TEST_SAMPLE_COUNT_FAST_DEBUG);
  }
  // Map human labels by ID for quick lookup
  const humanLabelsMap = mapHumanLabelsById(dataset);

  // Log evaluation start
  const sampleCount = samplesToEvaluate.length;
  // 3 checks per sample (mottoToxicity, mottoBrandFit, colorBrandFit)
  logJudgeStart(sampleCount * 3, process.env.JUDGE_MODEL || JUDGE_MODEL);
  const startTime = Date.now();

  // Evaluate and log results
  logProgress(startTime, 0, sampleCount);
  const evalResponse = await evalAll(samplesToEvaluate, {
    onProgress: (current, total) => logProgress(startTime, current, total)
  });
  const { rawStatsAllMetrics, mismatches, total, aligned } =
    computeAlignmentStats(evalResponse.results, humanLabelsMap);
  logMismatches(mismatches);
  const finalResults = calculateFinalAlignmentResults(rawStatsAllMetrics, total, aligned);
  logFinalResults(sampleCount, finalResults);
}

run().catch(console.error);

// --- Logging ---

function logTestStart(filePath: string) {
  console.log("\n\n================================");
  console.log("TEST: judge-human alignment");
  console.log("================================");
  console.log("Goal: Test that the LLM judge is aligned with human evaluations.\n");
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

function logFinalResults(sampleSize: number, results: FinalAlignmentResults) {
  const { statsAcrossMetrics, statsPerMetric } = results;
  console.log("\nTEST DONE for judge-human alignment!");
  console.log(`📊 RESULTS (Single iteration, ${sampleSize} samples):`);
  console.log("—-—-—-—-—----------");
  console.log("Overall:");
  console.log(`  Accuracy (judge-human alignment):  ${styleAccuracy(statsAcrossMetrics.accuracy)} (${statsAcrossMetrics.aligned}/${statsAcrossMetrics.total})`);
  // Note: Precision, Recall, and Cohen's Kappa are intentionally omitted from this Overall summary. 
  // Because our individual metrics evaluate fundamentally different tasks with inverted targets 
  // (e.g. when metrics have different targets), sum-pooling them artificially manipulates 
  // the baseline variance, resulting in mathematically invalid and heavily distorted scores.
  console.log("—-—-—-—-—----------");
  console.log("Breakdown by metric:");
  for (const metric of statsPerMetric) {
    console.log(`• ${metric.evalCriterion} [Target (positive class): ${metric.target}]`);
    const metricThresholds = (TEST_THRESHOLDS as any)[metric.evalCriterion] || {};
    const precThreshold = metricThresholds.PRECISION || 0;
    const recallThreshold = metricThresholds.RECALL || 0;
    const f1Threshold = metricThresholds.F1 || 0;

    console.log(`  Accuracy (judge-human alignment):  ${styleAccuracy(metric.accuracy)} (${metric.aligned}/${metric.total})`);
    console.log(`  Cohen's Kappa:                     ${styleKappa(metric.kappaScore)}`);
    console.log(`  Precision:                         ${stylePrecision(metric.precision, precThreshold)}`);
    console.log(`  Recall:                            ${styleRecall(metric.recall, recallThreshold)}`);
    console.log(`  F1 Score:                          ${styleF1(metric.f1Score, f1Threshold)}`);
  }
}
