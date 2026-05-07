/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as path from 'path';
import { EvalLabel, Mismatch, FinalStatsAcrossMetrics, FinalStatsPerMetric, FinalAlignmentResults, TestCaseInput, RawConsistencyResults, ConsistencyStatsPerItemMetric, ConsistencyVerdict, FinalConsistencyResults, BasicAlignmentResults, EVAL_CRITERIA, METRIC_TO_RESULT_KEY } from "../src/types";
import { TEST_THRESHOLDS as THRESHOLDS } from '../test/test.config';

let animationInterval: NodeJS.Timeout | null = null;
let animationFrame = 0;
let currentProgressBarDisplay = '';
const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function logProgress(startTime: number, current: number, total: number) {
  if (current === 0) {
    if (!animationInterval) {
      animationInterval = setInterval(() => {
        const frame = frames[animationFrame % frames.length];
        animationFrame++;
        process.stdout.write(`\r${frame} LLM judge is working... ⚖️🧠 ${currentProgressBarDisplay || 'Wait...'}`);
      }, 100);
    }
    return;
  }

  const percent = Math.floor((current / total) * 100);

  // Build bar representation (20 chars wide)
  const filled = Math.floor(percent / 5);
  const bar = '='.repeat(filled) + ' '.repeat(20 - filled);

  // Calculate ETA
  const elapsed = (Date.now() - startTime) / 1000;
  const rate = current / elapsed;
  const remaining = total - current;
  let eta = remaining / rate;
  if (!isFinite(eta) || isNaN(eta)) eta = 0;

  currentProgressBarDisplay = `[${bar}] ${percent}% | Done in ~${Math.ceil(eta)}s | ${current}/${total}`;

  if (current === total) {
    if (animationInterval) {
      clearInterval(animationInterval);
      animationInterval = null;
    }
    process.stdout.write(`\r✅ Done! ${currentProgressBarDisplay}\n`);
    currentProgressBarDisplay = ''; // Reset for next run
  }
}

// --- Data preparation ---

export function stripJsonComments(json: string) {
  return json
    .replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '$1')
    .replace(/,(?=\s*[}\]])/g, ''); // Remove trailing commas
}

export function getFilePath(callerDirname: string, defaultPath: string) {
  const args = process.argv.slice(2);
  const pathArg = args.find(arg => !arg.startsWith('--'));
  if (pathArg) return path.resolve(process.cwd(), pathArg);

  const envPath = process.env.DATASET_PATH;
  if (envPath) return path.resolve(process.cwd(), envPath);

  return path.join(callerDirname, defaultPath);
}

export function loadDataset(filePath: string): any[] {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const cleanContent = stripJsonComments(content);
    return JSON.parse(cleanContent);
  } catch (error: any) {
    console.error(`Failed to load or parse dataset at ${filePath}:`, error.message);
    process.exit(1);
    return [];
  }
}

export function extractItemsToEval(dataset: any[]): TestCaseInput[] {
  return dataset.map((sample: any) => ({
    id: sample.id,
    userInput: sample.userInput,
    appOutputs: sample.appOutputs || (sample.appOutput ? [sample.appOutput] : [])
  }));
}

export function mapHumanLabelsById(dataset: any[]): Map<string, any> {
  const humanLabelsMap = new Map();
  for (const sample of dataset) {
    humanLabelsMap.set(sample.id, sample.humanEvaluation);
  }
  return humanLabelsMap;
}

// --- Alignment logic ---

import { RawAlignmentResults, RawStatsPerMetric, TestCaseResult, MetricResult, EvalResult } from '../src/types';

export function computeAlignmentStats(evalResults: TestCaseResult[], humanLabelsMap: Map<string, Record<'mottoBrandFit' | 'mottoToxicity' | 'colorBrandFit', EvalResult>>): RawAlignmentResults {
  const stats: Record<'mottoBrandFit' | 'mottoToxicity' | 'colorBrandFit', RawStatsPerMetric> = {
    mottoBrandFit: { total: 0, aligned: 0, TP: 0, FP: 0, FN: 0, TN: 0, target: EvalLabel.FAIL },
    mottoToxicity: { total: 0, aligned: 0, TP: 0, FP: 0, FN: 0, TN: 0, target: EvalLabel.FAIL },
    colorBrandFit: { total: 0, aligned: 0, TP: 0, FP: 0, FN: 0, TN: 0, target: EvalLabel.FAIL }
  };

  const mismatches: Mismatch[] = [];
  let total = 0;
  let aligned = 0;

  for (const llmResult of evalResults) {
    const humanLabels = humanLabelsMap.get(llmResult.id);
    if (!humanLabels) {
      console.warn(`⚠️ Warning: No human evaluation found for sample ID: ${llmResult.id}`);
      continue;
    }

    for (const criterion of EVAL_CRITERIA) {
      const humanRes = humanLabels[criterion];
      const resultKey = METRIC_TO_RESULT_KEY[criterion];
      const llmRes = llmResult[resultKey] as MetricResult;

      if (!humanRes || !llmRes) continue;

      total++;
      const currentStat = stats[criterion];
      currentStat.total++;

      const isTargetHuman = humanRes.label === currentStat.target;
      const isTargetLLM = llmRes.label === currentStat.target;

      if (humanRes.label === llmRes.label) {
        // Human and LLM agree
        aligned++;
        currentStat.aligned++;
        if (isTargetHuman) currentStat.TP++;
        else currentStat.TN++;
      } else {
        // Human and LLM disagree
        if (isTargetLLM && !isTargetHuman) currentStat.FP++;
        if (!isTargetLLM && isTargetHuman) currentStat.FN++;

        mismatches.push({
          id: llmResult.id,
          evalCriterion: criterion,
          humanLabel: humanRes.label,
          llmLabel: llmRes.label,
          humanRationale: humanRes.rationale || '',
          llmRationale: llmRes.rationale || ''
        });
      }
    }
  }

  return { rawStatsAllMetrics: stats, mismatches, total, aligned };
}

export function computeBasicAlignmentStats(
  evalResults: TestCaseResult[],
  humanLabelsMap: Map<string, Record<'mottoBrandFit' | 'mottoToxicity' | 'colorBrandFit', EvalResult>>
): BasicAlignmentResults {
  const mismatches: Mismatch[] = [];
  let totalSampleCount = 0;
  let alignedSampleCount = 0;

  for (const llmResult of evalResults) {
    const humanLabelsForAllCriteria = humanLabelsMap.get(llmResult.id);
    if (!humanLabelsForAllCriteria) {
      console.warn(`⚠️ Warning: No human evaluation found for sample ID: ${llmResult.id}`);
      continue;
    }

    for (const criterion of EVAL_CRITERIA) {
      const humanEvalResult = humanLabelsForAllCriteria[criterion];
      const resultKey = METRIC_TO_RESULT_KEY[criterion];
      const llmEvalResult = llmResult[resultKey] as MetricResult;

      if (!humanEvalResult || !llmEvalResult) continue;

      totalSampleCount++;
      if (humanEvalResult.label === llmEvalResult.label) {
        alignedSampleCount++;
      } else {
        mismatches.push({
          id: llmResult.id,
          evalCriterion: criterion,
          humanLabel: humanEvalResult.label,
          llmLabel: llmEvalResult.label,
          humanRationale: humanEvalResult.rationale || '',
          llmRationale: llmEvalResult.rationale || ''
        });
      }
    }
  }
  const accuracy = calculatePercentage(alignedSampleCount, totalSampleCount)

  return { mismatches, totalSampleCount, alignedSampleCount, accuracy };
}


// --- Calculations ---

export function calculatePercentage(part: number, total: number): number {
  if (total === 0) return 0;
  return (part / total) * 100;
}

export function calculateKappaScore(TP: number, FP: number, TN: number, FN: number) {
  const total = TP + FP + FN + TN;
  if (total === 0) return 0;

  // Observed Agreement (po): How often LLM and human actually agree
  const po = (TP + TN) / total;

  // Expected Agreement (pe): The chance they would agree by pure luck
  // Probability that LLM chooses 'FAIL' (= Target = Positive class)
  const pLLMTarget = (TP + FP) / total;
  // Probability that LLM chooses 'PASS' (Non-Target = Negative class)
  const pLLMNonTarget = (FN + TN) / total;
  // Probability that Human chooses 'FAIL' (Target = Positive class)
  const pHumanTarget = (TP + FN) / total;
  // Probability that Human chooses 'PASS' (= Non-Target = Negative class)
  const pHumanNonTarget = (FP + TN) / total;

  // Expected agreement is the sum of the probabilities that both chose the same label by chance
  const pe = (pLLMTarget * pHumanTarget) + (pLLMNonTarget * pHumanNonTarget);

  // Calculate Kappa
  // Measures the proportion of agreement beyond what would be expected by chance.
  if (1 - pe !== 0) {
    return (po - pe) / (1 - pe);
  }
  return 0;
}

export function calculateStats(TP: number, FP: number, TN: number, FN: number) {
  // Compute accuracy dynamically from TP/TN/FP/FN instead of passing pre-computed metrics (total or aligned) to ensure a single source of truth and prevent state-drift bugs.
  // accuracy = true positives / all metrics (true positives + false negatives + true negatives + false positives)
  // = should be the same as aligned / total evaluated
  // Note: Since the human is the baseline, this accuracy metric mathematically represents the human-alignment rate.
  const total = TP + FP + FN + TN;
  const accuracy = calculatePercentage(TP + TN, total);
  // precision = true positives / (true positives + false positives)
  const precision = calculatePercentage(TP, TP + FP);
  // recall = true positives / (true positives + false negatives)
  const recall = calculatePercentage(TP, TP + FN);
  // Cohen's Kappa to offset luck
  const kappaScore = calculateKappaScore(TP, FP, TN, FN);
  const f1Score = (precision + recall) > 0 ? 2 * (precision * recall) / (precision + recall) : 0;
  return { accuracy, precision, recall, kappaScore, f1Score };
}

export function calculateFinalAlignmentResults(stats: any, total: number, aligned: number): FinalAlignmentResults {
  // Evaluated and aligned across samples
  const { TP: overallTP, FP: overallFP, FN: overallFN, TN: overallTN } = Object.values(stats).reduce<{ TP: number, FP: number, FN: number, TN: number }>(
    (acc, stat: any) => {
      acc.TP += stat.TP;
      acc.FP += stat.FP;
      acc.FN += stat.FN;
      acc.TN += stat.TN;
      return acc;
    },
    { TP: 0, FP: 0, FN: 0, TN: 0 }
  );
  const { accuracy, precision, recall, kappaScore } = calculateStats(overallTP, overallFP, overallTN, overallFN);
  // Note: We intentionally discard the mega-pooled Precision, Recall, and Kappa here, 
  // as combining TP/FP/FN/TN across inverted targets makes them functionally meaningless.
  const statsAcrossMetrics: FinalStatsAcrossMetrics = {
    accuracy: accuracy,
    aligned: aligned,
    total: total
  };

  const statsPerMetric: FinalStatsPerMetric[] = [];
  for (const [metric, stat] of Object.entries(stats) as [string, any][]) {
    const { accuracy, precision, recall, kappaScore, f1Score } = calculateStats(stat.TP, stat.FP, stat.TN, stat.FN);
    statsPerMetric.push({
      evalCriterion: metric,
      target: stat.target,
      accuracy: accuracy,
      kappaScore: kappaScore,
      precision: precision,
      recall: recall,
      f1Score: f1Score,
      aligned: stat.aligned,
      total: stat.total
    });
  }

  return { statsAcrossMetrics, statsPerMetric };
}

// --- Color coding for logging ---

const COLOR_GREEN = '\x1b[32m';
const COLOR_RED = '\x1b[31m';
const COLOR_RESET = '\x1b[0m';

export function styleAccuracy(value: number): string {
  const color = value >= THRESHOLDS.ACCURACY ? COLOR_GREEN : COLOR_RED;
  return `${color}${value.toFixed(2)}%${COLOR_RESET}`;
}

export function styleKappa(value: number): string {
  const color = value >= THRESHOLDS.KAPPA ? COLOR_GREEN : COLOR_RED;
  return `${color}${value.toFixed(3)}${COLOR_RESET}`;
}

export function stylePrecision(val: number, threshold: number): string {
  const color = val >= threshold ? COLOR_GREEN : COLOR_RED;
  return `${color}${val.toFixed(2)}%${COLOR_RESET}`;
}

export function styleRecall(val: number, threshold: number): string {
  const color = val >= threshold ? COLOR_GREEN : COLOR_RED;
  return `${color}${val.toFixed(2)}%${COLOR_RESET}`;
}

export function styleF1(val: number, threshold: number): string {
  const color = val >= threshold ? COLOR_GREEN : COLOR_RED;
  return `${color}${val.toFixed(2)}%${COLOR_RESET}`;
}

export function styleConsistencyVerdict(verdict: ConsistencyVerdict): string {
  let styledVerdict = verdict.padEnd(10);
  if (verdict === "STABLE") {
    return "\x1b[32m" + styledVerdict + "\x1b[0m"; // Green
  } else if (verdict === "VARIABLE") {
    return "\x1b[33m" + styledVerdict + "\x1b[0m"; // Yellow
  } else {
    return "\x1b[31m" + styledVerdict + "\x1b[0m"; // Red
  }
}

export function computeConsistencyStats(results: RawConsistencyResults[]): FinalConsistencyResults {
  let totalConsistencySum = 0;
  let totalMetricsEvaluated = 0;
  const breakdownByItemMetric: ConsistencyStatsPerItemMetric[] = [];

  results.forEach(item => {
    const metrics = ["mottoToxicity", "mottoBrandFit", "colorBrandFit"] as const;

    metrics.forEach(metric => {
      const values = item[metric];
      const passCount = values.filter((v: EvalLabel) => v === EvalLabel.PASS).length;
      const total = values.length;

      if (total === 0) return;

      const passProbability = passCount / total;
      const variance = passProbability * (1 - passProbability);

      const majorityCount = Math.max(passCount, total - passCount);
      const consistency = (majorityCount / total) * 100;

      let verdict: ConsistencyVerdict = "STABLE";
      if (consistency < 80) verdict = "UNSTABLE";
      else if (consistency < 95) verdict = "VARIABLE";

      breakdownByItemMetric.push({
        id: item.id,
        evalCriterion: metric,
        passProbability,
        variance,
        consistency,
        verdict
      });

      totalConsistencySum += consistency;
      totalMetricsEvaluated++;
    });
  });

  const overallConsistency = totalMetricsEvaluated > 0 ? (totalConsistencySum / totalMetricsEvaluated) : 0;

  return {
    statsAcrossMetrics: { overallConsistency },
    breakdownByItemMetric
  };
}