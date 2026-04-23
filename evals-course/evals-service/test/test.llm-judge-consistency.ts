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
import {
  EvalLabel,
  FinalConsistencyResults,
  RawConsistencyResults
} from '../src/types';
import { TEST_CONSISTENCY_ITERATIONS, TEST_DEFAULT_DATASET_PATH_CONSISTENCY, TEST_SAMPLE_COUNT_FAST_DEBUG } from './test.config';
import { styleConsistencyVerdict, getFilePath, loadDataset, extractItemsToEval, logProgress, computeConsistencyStats } from './utils.test';

// --- Logging ---

function logTestStart(filePath: string) {
  console.log("\n\n================================================");
  console.log("TEST: LLM judge consistency");
  console.log("================================================");
  console.log(`Goal: Test that the LLM judge is consistent with itself across multiple runs. Using ${TEST_CONSISTENCY_ITERATIONS} iterations.\n`);
  console.log(`Using dataset: ${filePath}`);
}

function logJudgeStart(totalApiCallsExpected: number, model: string) {
  console.log(`Using LLM judge (${model} with custom prompt). Total API calls expected: ${totalApiCallsExpected}.\n`);
}

function logFinalResults(results: FinalConsistencyResults, iterations: number, sampleSize: number) {
  const { statsAcrossMetrics, breakdownByItemMetric } = results;
  console.log("\nTEST DONE for LLM judge consistency!");
  console.log(`📊 RESULTS: (iterations=${iterations}, ${sampleSize} samples per iteration)`);
  console.log("—-—-—-—-—----------");
  console.log(`Overall consistency: ${statsAcrossMetrics.overallConsistency.toFixed(2)}%\n`);

  console.log("------------------------------------------------------------------------------------------");
  console.log("| ID                 | Metric           | Pass % | Variance | Consistency % | Verdict    |");
  console.log("|--------------------|------------------|--------|----------|---------------|------------|");

  for (const item of breakdownByItemMetric) {
    const passProb = (item.passProbability * 100).toFixed(0).padStart(5);
    const variance = item.variance.toFixed(4).padStart(8);
    const consty = item.consistency.toFixed(1).padStart(11);
    const styledVerdict = styleConsistencyVerdict(item.verdict);

    console.log(`| ${item.id.padEnd(18)} | ${item.evalCriterion.padEnd(16)} | ${passProb}% | ${variance} | ${consty}%  | ${styledVerdict} |`);
  }
  console.log(`------------------------------------------------------------------------------------------`);
}

// --- Main execution ---

async function run() {
  const datasetPath = getFilePath(__dirname, TEST_DEFAULT_DATASET_PATH_CONSISTENCY);
  logTestStart(datasetPath);

  const dataset = loadDataset(datasetPath);
  let testCases = extractItemsToEval(dataset);

  const isFast = process.argv.includes('--fast');
  if (isFast) {
    console.log(`\x1b[33m⚠️⚡️ Using FAST MODE. Use this mode only for debugging your evals suite itself. Evaluating only ${TEST_SAMPLE_COUNT_FAST_DEBUG} samples out of the ${testCases.length} available.\x1b[0m\n`);
    testCases = testCases.slice(0, TEST_SAMPLE_COUNT_FAST_DEBUG);
  }

  const sampleCount = testCases.length;
  // 3 checks per sample per iteration
  logJudgeStart(sampleCount * TEST_CONSISTENCY_ITERATIONS * 3, process.env.JUDGE_MODEL || JUDGE_MODEL);

  // Format the raw results accumulator directly matching the new type
  const rawResultsMap = new Map<string, { mottoToxicity: EvalLabel[], mottoBrandFit: EvalLabel[], colorBrandFit: EvalLabel[] }>();
  testCases.forEach(tc => {
    rawResultsMap.set(tc.id, {
      mottoToxicity: [],
      mottoBrandFit: [],
      colorBrandFit: []
    });
  });

  const startTime = Date.now();
  let completedEvaluations = 0;
  const totalEvaluations = TEST_CONSISTENCY_ITERATIONS * sampleCount;

  logProgress(startTime, 0, totalEvaluations);

  for (let i = 0; i < TEST_CONSISTENCY_ITERATIONS; i++) {
    const responses = await Promise.all(testCases.map(async tc => {
      const response = await evalAll([tc]);
      completedEvaluations++;
      logProgress(startTime, completedEvaluations, totalEvaluations);
      return response;
    }));

    responses.forEach((response, index) => {
      if (response.results && response.results.length > 0) {
        const res = response.results[0];
        const tcId = testCases[index].id;
        const mapped = rawResultsMap.get(tcId)!;
        mapped.mottoToxicity.push(res.mottoToxicity.label);
        mapped.mottoBrandFit.push(res.mottoBrandFit.label);
        mapped.colorBrandFit.push(res.colorBrandFit.label);
      }
    });
  }

  console.log(`\nChecks complete in ${((Date.now() - startTime) / 1000).toFixed(2)}s\n`);

  // Convert Map to Array format for utility computation
  const rawResultsArray: RawConsistencyResults[] = Array.from(rawResultsMap.entries()).map(([id, metrics]) => ({
    id,
    mottoToxicity: metrics.mottoToxicity,
    mottoBrandFit: metrics.mottoBrandFit,
    colorBrandFit: metrics.colorBrandFit
  }));

  const finalResults = computeConsistencyStats(rawResultsArray);
  logFinalResults(finalResults, TEST_CONSISTENCY_ITERATIONS, sampleCount);
}

run();
