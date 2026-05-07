/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as dotenv from 'dotenv';
dotenv.config({ quiet: true });
import * as fs from 'fs';
import * as path from 'path';
import { evalAll, loadedJudgeVersion } from '../src/eval.service';
import { EvalLabel, TestCaseResult, EvalResponse, MetricResult, EvalResult, ExpectedOutcome, TestCase } from '../src/types';
import { themeBuilder, THEME_BUILDER_SYSTEM_INSTRUCTION, THEME_BUILDER_PROMPT_TEMPLATE } from '../../theme-builder/theme-builder';
import { TEST_SAMPLE_COUNT_FAST_DEBUG } from './test.config';
import { JUDGE_MODEL, APP_MODEL, EVALS_ITERATION_COUNT_DEFAULT } from '../src/app.config';
import { generateHtmlReport } from '../src/utils.reporter';

let judgeAnimationInterval: NodeJS.Timeout | null = null;
let judgeAnimationFrame = 0;
const judgeFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function startJudgeSpinner(sampleId: string) {
   if (!judgeAnimationInterval) {
      judgeAnimationFrame = 0;
      judgeAnimationInterval = setInterval(() => {
         const frame = judgeFrames[judgeAnimationFrame % judgeFrames.length];
         judgeAnimationFrame++;
         process.stdout.write(`\r${frame} [${sampleId}] LLM judge is working... ⚖️🧠 `);
      }, 100);
   }
}

function stopJudgeSpinner() {
   if (judgeAnimationInterval) {
      clearInterval(judgeAnimationInterval);
      judgeAnimationInterval = null;
      // Clear the line using ANSI code
      process.stdout.write('\r\x1b[K');
   }
}

async function runUnitTests() {
   const datasetPath = path.join(__dirname, '../data/unit-test-dataset.jsonc');
   if (!fs.existsSync(datasetPath)) {
      console.error(`❌ Dataset not found at ${datasetPath}`);
      return;
   }

   let dataset: TestCase[] = JSON.parse(fs.readFileSync(datasetPath, 'utf-8'));

   const isFast = process.argv.includes('--fast');
   if (isFast) {
      console.log(`\x1b[33m⚠️⚡️ Using FAST MODE. Use this mode only for debugging your evals suite itself. Evaluating only ${TEST_SAMPLE_COUNT_FAST_DEBUG} samples out of the ${dataset.length} available.\x1b[0m\n`);
      dataset = dataset.slice(0, TEST_SAMPLE_COUNT_FAST_DEBUG);
   }

   console.log("\n================================");
   console.log("TEST: extended unit tests");
   console.log("================================");
   console.log("Goal: evaluate ThemeBuilder output against static rules and evals (rule-based + LLM judge).\n");
   console.log(`Using dataset: ${datasetPath}`);
   console.log(`Total test cases: ${dataset.length}\n`);

   let passCount = 0;
   let failCount = 0;
   let errorCount = 0;
   const allEvalResults: TestCaseResult[] = [];

   for (const testCase of dataset) {
      console.log(`\n• [${testCase.id}] ${testCase.userInput.companyName}`);
      let testCasePassed = true;

      try {
         // Call real ThemeBuilder LLM N times to generate candidate outputs
         const appOutputs: any[] = [];
         for (let i = 0; i < EVALS_ITERATION_COUNT_DEFAULT; i++) {
            const appOutput = await themeBuilder(testCase.userInput);
            appOutputs.push(appOutput);
         }

         // Run dynamic evaluation using evalAll
         startJudgeSpinner(testCase.id);
         const evalResponse = await evalAll(
            [{ id: testCase.id, userInput: testCase.userInput, appOutputs, expectedOutcome: testCase.expected }],
            { appMetadata: { model: JUDGE_MODEL, temperature: 0, thinkingLevel: "HIGH", systemInstruction: "You are a senior brand strategist..." } }
         );
         stopJudgeSpinner();

         const res = evalResponse.results[0];
         allEvalResults.push(res);

         // Print results per metric
         // 1. App gate (now fully dynamic appGateResult!)
         if (res.appGateResult.label === EvalLabel.PASS) {
            const rationaleSuffix = res.appGateResult.rationale && res.appGateResult.rationale !== 'NONE'
               ? ` (${res.appGateResult.rationale})`
               : '';
            console.log(`  App Gate: \x1b[32mPASS\x1b[0m${rationaleSuffix}`);
         } else if (res.appGateResult.label === EvalLabel.ERROR) {
            console.log(`  App Gate: \x1b[33mERROR\x1b[0m (Rationale: ${res.appGateResult.rationale})`);
            testCasePassed = false;
         } else {
            console.log(`  App Gate: \x1b[31mFAIL\x1b[0m (Rationale: ${res.appGateResult.rationale})`);
            testCasePassed = false;
         }

         // Helper function to log outcome
         const logMetric = (name: string, result: MetricResult, showDetails = false) => {
            const label = result.label;
            const details = showDetails && result.stabilityRate !== undefined
               ? ` (Stability: ${(result.stabilityRate * 100).toFixed(0)}% | Iterations: [${result.evalResults?.map(it => (it as any).label).join(', ')}])`
               : '';
            if (label === EvalLabel.PASS) {
               console.log(`  ${name}: \x1b[32mPASS\x1b[0m${details}`);
            } else if (label === EvalLabel.SKIPPED) {
               console.log(`  ${name}: \x1b[90mSKIPPED\x1b[0m`);
            } else if (label === EvalLabel.ERROR) {
               console.log(`  ${name}: \x1b[33mERROR\x1b[0m${details}\n  Rationale: ${result.rationale}`);
               testCasePassed = false;
            } else {
               console.log(`  ${name}: \x1b[31mFAIL\x1b[0m${details}\n  Rationale: ${result.rationale}`);
               testCasePassed = false;
            }
         };

         logMetric("Data Format", res.dataFormat);
         logMetric("Contrast Ratio", res.contrast);
         logMetric("Motto Brand Fit", res.mottoBrandFit, true);
         logMetric("Color Brand Fit", res.colorBrandFit, true);
         logMetric("Motto Toxicity", res.mottoToxicity, true);

      } catch (e: any) {
         console.error(`  Result: \x1b[31mCRASHED\x1b[0m (${e.message})`);
         testCasePassed = false;
         allEvalResults.push({
            id: testCase.id,
            userInput: testCase.userInput,
            expectedOutcome: testCase.expected,
            appOutputs: [],
            appGateResult: { label: EvalLabel.FAIL, rationale: `Runner crashed: ${e.message}` },
            dataFormat: { label: EvalLabel.FAIL, rationale: `Crashed during execution: ${e.message}`, stabilityRate: 0, evalResults: [] },
            colorBrandFit: { label: EvalLabel.FAIL, rationale: "Crashed", stabilityRate: 0, evalResults: [] },
            contrast: { label: EvalLabel.FAIL, rationale: "Crashed", stabilityRate: 0, evalResults: [] },
            mottoToxicity: { label: EvalLabel.FAIL, rationale: "Crashed", stabilityRate: 0, evalResults: [] },
            mottoBrandFit: { label: EvalLabel.FAIL, rationale: "Crashed", stabilityRate: 0, evalResults: [] }
         });
      }

      const lastRes = allEvalResults[allEvalResults.length - 1];
      const resLabels = lastRes ? [lastRes.appGateResult?.label, lastRes.contrast?.label, lastRes.dataFormat?.label, lastRes.mottoBrandFit?.label, lastRes.colorBrandFit?.label, lastRes.mottoToxicity?.label] : [];

      if (resLabels.includes(EvalLabel.ERROR)) {
         errorCount++;
      } else if (resLabels.includes(EvalLabel.FAIL) || !testCasePassed) {
         failCount++;
      } else {
         passCount++;
      }
   }

   const passResults = `\x1b[32m${passCount} PASS\x1b[0m`;
   const failResults = failCount > 0 ? `\x1b[31m${failCount} FAIL\x1b[0m` : `${failCount} FAIL`;
   const errorResults = errorCount > 0 ? `\x1b[33m${errorCount} ERROR\x1b[0m` : `${errorCount} ERROR`;

   console.log("\n================================");
   console.log("TEST DONE");
   console.log("📊 RESULTS:");
   console.log(`✅ ${passResults}, ❌ ${failResults}, ⚠️ ${errorResults}`);
   console.log("================================");

   // Generate Final HTML Report
   console.log("\nGenerating HTML evaluation report...");
   const reportDir = path.join(__dirname, '../reports');

   const systemInstructionInfo = THEME_BUILDER_SYSTEM_INSTRUCTION;
   const promptTemplateInfo = THEME_BUILDER_PROMPT_TEMPLATE;

   const evalResponseForReport: EvalResponse = {
      results: allEvalResults,
      modelVersion: process.env.JUDGE_MODEL || JUDGE_MODEL,
      judgeVersion: loadedJudgeVersion,
      appMetadata: {
         model: process.env.AI_MODEL || APP_MODEL,
         systemInstruction: systemInstructionInfo,
         promptTemplate: promptTemplateInfo
      }
   };

   try {
      const reportPath = generateHtmlReport(evalResponseForReport, reportDir);
      console.log(`📊 Evals HTML Report generated at: ${reportPath}`);
      console.log(`🌐 Multi-run dashboard index updated at: ${path.join(reportDir, 'index.html')}`);
   } catch (reportError: any) {
      console.error(`❌ Failed to generate HTML report: ${reportError.message}`);
   }
}

runUnitTests().catch(console.error);
