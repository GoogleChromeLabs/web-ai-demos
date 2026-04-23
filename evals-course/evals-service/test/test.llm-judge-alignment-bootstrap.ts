/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ quiet: true });
import { evalAll } from '../src/eval.service';
import { JUDGE_MODEL } from '../src/app.config';
import { FinalStatsAcrossMetrics, FinalStatsPerMetric, FinalAlignmentResults, EvalLabel, FinalBootstrapAlignmentResults, BootstrapStat } from '../src/types';
import {
  computeAlignmentStats, calculateFinalAlignmentResults,
  extractItemsToEval, mapHumanLabelsById, logProgress,
  getFilePath, loadDataset
  , styleAccuracy, styleKappa, stylePrecision, styleRecall, styleF1
} from './utils.test';
import { TEST_DEFAULT_DATASET_PATH_ALIGNMENT, TEST_SAMPLE_COUNT_FAST_DEBUG, TEST_ALIGNMENT_BOOTSTRAP_ITERATIONS, TEST_THRESHOLDS } from './test.config';

// Bootstrap (multiple passes with replacement), for more robust statistical analysis

// --- Computation ---

function computeBootstrapStats(iterations: number, resultsStats: FinalAlignmentResults[]): FinalBootstrapAlignmentResults {
  const calcStats = (key: keyof FinalStatsAcrossMetrics): BootstrapStat => {
    const values = resultsStats.map(s => s.statsAcrossMetrics[key] as number);
    return {
      min: Math.min(...values),
      max: Math.max(...values),
      avg: values.reduce((a, b) => a + b, 0) / iterations,
      variance: Math.max(...values) - Math.min(...values)
    };
  };

  const computeStatsPerMetric = (metricName: string, key: keyof FinalStatsPerMetric): BootstrapStat => {
    const values = resultsStats.map(s => {
      const metric = s.statsPerMetric.find(m => m.evalCriterion === metricName);
      return metric ? (metric[key] as number) : 0;
    });
    return {
      min: Math.min(...values),
      max: Math.max(...values),
      avg: values.reduce((a, b) => a + b, 0) / iterations,
      variance: Math.max(...values) - Math.min(...values)
    };
  };


  // Target defines the Positive class for our statistical formulas. 
  // To calculate precision and recall, we need to know what outcome we're actively trying to "catch"
  // We unified all targets to FAIL (defect detection / filter mindset).
  // Catching a FAIL is our True Positive for all metrics.
  const metricTargets = [
    { key: 'mottoBrandFit', target: EvalLabel.FAIL },
    { key: 'mottoToxicity', target: EvalLabel.FAIL },
    { key: 'colorBrandFit', target: EvalLabel.FAIL }
  ];

  const metrics = metricTargets.map(({ key, target }) => ({
    evalCriterion: key,
    target,
    accuracy: computeStatsPerMetric(key, 'accuracy'),
    kappaScore: computeStatsPerMetric(key, 'kappaScore'),
    precision: computeStatsPerMetric(key, 'precision'),
    recall: computeStatsPerMetric(key, 'recall'),
    f1Score: computeStatsPerMetric(key, 'f1Score')
  }));

  return {
    statsAcrossMetrics: {
      accuracy: calcStats('accuracy'),
      avgAlignedEvals: calcStats('aligned').avg,
      avgTotalEvals: calcStats('total').avg
    },
    statsPerMetric: metrics
  };
}

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
  const humanLabelsMap = mapHumanLabelsById(dataset);

  // Log evaluation start
  const sampleCount = samplesToEvaluate.length;
  // 3 checks per sample, ITERATIONS iterations (printing expected size)
  logJudgeStart(sampleCount * TEST_ALIGNMENT_BOOTSTRAP_ITERATIONS * 3, process.env.JUDGE_MODEL || JUDGE_MODEL);
  const startTime = Date.now();

  // Call the LLM once per unique sample upfront. Because bootstrap sampling is done *with replacement*, 
  // the exact same items will be selected multiple times. Fetching them upfront avoids hitting
  // API rate limits and saves time/cost compared to re-evaluating identical duplicates.
  logProgress(startTime, 0, sampleCount);
  const allEvalResults = await evalAll(samplesToEvaluate, {
    onProgress: (current, total) => logProgress(startTime, current, total)
  });
  const llmResultsMap = new Map();
  for (const result of allEvalResults.results) {
    llmResultsMap.set(result.id, result);
  }

  // Bootstrap, evaluate and log results
  const resultsStats: FinalAlignmentResults[] = [];
  logBootstrapStart(TEST_ALIGNMENT_BOOTSTRAP_ITERATIONS, sampleCount);
  for (let i = 0; i < TEST_ALIGNMENT_BOOTSTRAP_ITERATIONS; i++) {
    const bootstrapSampleIds: string[] = [];
    for (let j = 0; j < sampleCount; j++) {
      const randomIndex = Math.floor(Math.random() * samplesToEvaluate.length);
      bootstrapSampleIds.push(samplesToEvaluate[randomIndex].id);
    }
    // Build the resampled array of results
    const resampledResults = [];
    for (const id of bootstrapSampleIds) {
      const result = llmResultsMap.get(id);
      if (result) {
        resampledResults.push(result);
      }
    }
    const { rawStatsAllMetrics, total, aligned } = computeAlignmentStats(resampledResults, humanLabelsMap);
    const finalResults = calculateFinalAlignmentResults(rawStatsAllMetrics, total, aligned);
    logIteration(i + 1, finalResults.statsAcrossMetrics);
    resultsStats.push(finalResults);
  }
  const bootstrapStats = computeBootstrapStats(TEST_ALIGNMENT_BOOTSTRAP_ITERATIONS, resultsStats);
  logFinalResults(TEST_ALIGNMENT_BOOTSTRAP_ITERATIONS, sampleCount, bootstrapStats);
}

run().catch(console.error);

// --- Logging ---

function logTestStart(filePath: string) {
  console.log("\n\n================================================");
  console.log("TEST: judge-human alignment with resampling");
  console.log("================================================");
  console.log("Goal: Test that the LLM judge is aligned with human evaluations. Using resampling (bootstrapping) for robustness.\n");
  console.log(`Using dataset: ${filePath}`);
}

function logJudgeStart(totalApiCallsExpected: number, model: string) {
  console.log(`Using LLM judge (${model} with custom prompt). Total API calls expected: ${totalApiCallsExpected}.\n`);
}

function logBootstrapStart(iterations: number, sampleCount: number) {
  console.log(`\nStarting bootstrap evaluation (${iterations} iterations of randomly sampling ${sampleCount} items with replacement)...`);
}

function logIteration(iteration: number, statsAcrossMetrics: FinalStatsAcrossMetrics) {
  console.log(`Iteration ${iteration} overall alignment: ${styleAccuracy(statsAcrossMetrics.accuracy)}`);
}

function logFinalResults(iterations: number, sampleSize: number, stats: FinalBootstrapAlignmentResults) {
  console.log("\nTEST DONE for LLM judge human alignement with resampling!");
  console.log(`📊 RESULTS: (iterations=${iterations}, ${sampleSize} samples per iteration):`);
  console.log("—-—-—-—-—----------");
  console.log("Overall (across runs and metrics):");
  console.log(`  Accuracy (judge-human alignment):  ${stats.statsAcrossMetrics.accuracy.avg.toFixed(2)}% (${stats.statsAcrossMetrics.avgAlignedEvals.toFixed(0)}/${stats.statsAcrossMetrics.avgTotalEvals.toFixed(0)})`);
  console.log(`    Max: ${stats.statsAcrossMetrics.accuracy.max.toFixed(2)}% | Min: ${stats.statsAcrossMetrics.accuracy.min.toFixed(2)}% | Score Variance: ${stats.statsAcrossMetrics.accuracy.variance.toFixed(2)}%`);
  console.log("—-—-—-—-—----------");
  console.log("Breakdown by metric:");

  for (const metric of stats.statsPerMetric) {
    console.log(`• ${metric.evalCriterion} [Target (positive class): ${metric.target}]`);
    const metricThresholds = (TEST_THRESHOLDS as any)[metric.evalCriterion] || {};
    const precThreshold = metricThresholds.PRECISION || 0;
    const recallThreshold = metricThresholds.RECALL || 0;
    const f1Threshold = metricThresholds.F1 || 0;

    console.log(`  Accuracy (judge-human alignment):  ${styleAccuracy(metric.accuracy.avg)}`);
    console.log(`    Max: ${metric.accuracy.max.toFixed(2)}% | Min: ${metric.accuracy.min.toFixed(2)}% | Score Variance: ${metric.accuracy.variance.toFixed(2)}%`);
    console.log(`  Cohen's Kappa:                     ${styleKappa(metric.kappaScore.avg)}`);
    console.log(`    Max: ${metric.kappaScore.max.toFixed(3)} | Min: ${metric.kappaScore.min.toFixed(3)} | Variance: ${metric.kappaScore.variance.toFixed(3)}`);
    console.log(`  Precision:                         ${stylePrecision(metric.precision.avg, precThreshold)}`);
    console.log(`    Max: ${metric.precision.max.toFixed(2)}% | Min: ${metric.precision.min.toFixed(2)}% | Score Variance: ${metric.precision.variance.toFixed(2)}%`);
    console.log(`  Recall:                            ${styleRecall(metric.recall.avg, recallThreshold)}`);
    console.log(`    Max: ${metric.recall.max.toFixed(2)}% | Min: ${metric.recall.min.toFixed(2)}% | Score Variance: ${metric.recall.variance.toFixed(2)}%`);
    console.log(`  F1 Score:                          ${styleF1(metric.f1Score.avg, f1Threshold)}`);
    console.log(`    Max: ${metric.f1Score.max.toFixed(2)}% | Min: ${metric.f1Score.min.toFixed(2)}% | Score Variance: ${metric.f1Score.variance.toFixed(2)}%`);
  }
}