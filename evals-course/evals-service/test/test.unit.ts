/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as dotenv from 'dotenv';
dotenv.config({ quiet: true });
import * as fs from 'fs';
import * as path from 'path';
import { evalAll } from '../src/eval.service';
import { EvalLabel } from '../src/types';
import { themeBuilder } from '../../theme-builder/theme-builder';
import { TEST_SAMPLE_COUNT_FAST_DEBUG } from './test.config';


// Enum for expected test outcomes
enum ExpectedOutcome {
   SUCCESS = "SUCCESS",
   SAFETY_BLOCK = "SAFETY_BLOCK",
   LOW_CONTEXT_ERROR = "LOW_CONTEXT_ERROR"
}

// Boilerplate interface for testCase (adjust if needed)
interface TestCase {
   id: string;
   userInput: any;
   expected: ExpectedOutcome;
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
   console.log(`Total samples: ${dataset.length}\n`);

   let passCount = 0;
   let failCount = 0;

   for (const testCase of dataset) {
      console.log(`\n• [${testCase.id}] ${testCase.userInput.companyName}`);
      let testCasePassed = true;

      try {
         // Call real ThemeBuilder LLM
         const appOutput = await themeBuilder(testCase.userInput);

         if (testCase.expected === ExpectedOutcome.LOW_CONTEXT_ERROR) {
            if (!appOutput.success && appOutput.errorCode === "LOW_CONTEXT_ERROR") {
               console.log("  Result: \x1b[32mPASS\x1b[0m (static rule: successfully blocked low-context input (LOW_CONTEXT_ERROR).)");
            } else {
               console.log("  Result: \x1b[31mFAIL\x1b[0m (builder failed to block low-context input.)");
               testCasePassed = false;
            }
         } else if (testCase.expected === ExpectedOutcome.SAFETY_BLOCK) {
            // Verify if it was blocked
            if (!appOutput.success && appOutput.errorCode === "SAFETY_BLOCK") {
               console.log("  Result: \x1b[32mPASS\x1b[0m (static rule: successfully blocked adversarial input (SAFETY_BLOCK).)");
            } else {
               console.log("  Result: NOT BLOCKED IN FRONT (builder did not block it). Let's call the judge to check toxicity.");
               // Check if toxic anyway
               const evalResponse = await evalAll([{ id: testCase.id, userInput: testCase.userInput, appOutput: appOutput as any }]);
               const res = evalResponse.results[0];
               if (res.mottoToxicity.label === EvalLabel.FAIL) {
                  console.log(`  Judge check: \x1b[32mPASS\x1b[0m (judge successfully caught the toxicity.)`);
               } else {
                  console.log(`  Judge check: \x1b[31mFAIL\x1b[0m (the judge missed the toxicity.)`);
                  testCasePassed = false;
               }
            }
         } else {
            // SUCCESS Case: Verify if it's a GOOD brand fit
            if (!appOutput.success) {
               console.log(`  Result: \x1b[31mFAIL\x1b[0m (Unexpectedly blocked valid inputs. Error: ${appOutput.errorCode})`);
               testCasePassed = false;
            } else {
               console.log("  Static check: \x1b[32mPASS\x1b[0m. Now running evals...");
               const evalResponse = await evalAll([{ id: testCase.id, userInput: testCase.userInput, appOutput: appOutput as any }]);
               const res = evalResponse.results[0];

               // Contrast Ratio Check (Rule-based eval)
               if (res.contrast.label === EvalLabel.PASS) {
                  console.log("  contrast: \x1b[32mPASS\x1b[0m");
               } else {
                  console.log("  contrast: \x1b[31mFAIL\x1b[0m");
                  console.log(`  Rationale: ${res.contrast.rationale}`);
                  testCasePassed = false;
               }

               // Data format check (Rule-based eval)
               if (res.dataFormat.label === EvalLabel.PASS) {
                  console.log("  dataFormat: \x1b[32mPASS\x1b[0m");
               } else {
                  console.log("  dataFormat: \x1b[31mFAIL\x1b[0m");
                  console.log(`  Rationale: ${res.dataFormat.rationale}`);
                  testCasePassed = false;
               }

               // Motto Brand Fit Check (LLM eval)
               if (res.mottoBrandFit.label === EvalLabel.PASS) {
                  console.log("  mottoBrandFit: \x1b[32mPASS\x1b[0m");
               } else {
                  console.log("  mottoBrandFit: \x1b[31mFAIL\x1b[0m");
                  console.log(`  Rationale: ${res.mottoBrandFit.rationale}`);
                  testCasePassed = false;
               }

               // Color Palette Brand Fit Check (LLM eval)
               if (res.colorBrandFit.label === EvalLabel.PASS) {
                  console.log("  colorBrandFit: \x1b[32mPASS\x1b[0m");
               } else {
                  console.log("  colorBrandFit: \x1b[31mFAIL\x1b[0m");
                  console.log(`  Rationale: ${res.colorBrandFit.rationale}`);
                  testCasePassed = false;
               }

               // Toxicity Check, expect PASS for non-toxic (LLM eval)
               if (res.mottoToxicity.label === EvalLabel.PASS) {
                  console.log("  mottoToxicity: \x1b[32mPASS\x1b[0m");
               } else {
                  console.log("  mottoToxicity: \x1b[31mFAIL\x1b[0m");
                  console.log(`  Rationale: ${res.mottoToxicity.rationale}`);
                  testCasePassed = false;
               }
            }
         }

      } catch (e: any) {
         console.error(`  Result: \x1b[31mCRASHED\x1b[0m (${e.message})`);
         testCasePassed = false;
      }

      if (testCasePassed) {
         passCount++;
      } else {
         failCount++;
      }
   }

   const passResults = `\x1b[32m${passCount} PASS\x1b[0m`;
   const failResults = failCount > 0
      ? `\x1b[31m${failCount} FAIL\x1b[0m`
      : `${failCount} FAIL`;

   console.log("\n================================");
   console.log("TEST DONE");
   console.log("📊 RESULTS:");
   console.log(`✅ ${passResults}, ❌ ${failResults}`);
   console.log("================================");
}

runUnitTests().catch(console.error);
