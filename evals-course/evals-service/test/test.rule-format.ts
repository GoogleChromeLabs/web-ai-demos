/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import dotenv from 'dotenv';
dotenv.config({ quiet: true });

import { evalDataFormat } from '../src/eval.service';
import { EvalLabel, AppOutput, ColorPalette } from '../src/types';
import { TEST_SAMPLE_COUNT_FAST_DEBUG } from './test.config';

async function run() {
  console.log("================================");
  console.log("TEST: data format evaluator");
  console.log("================================");

  console.log("Testing that the format evaluation function catches format errors...\n")

  let testCases: { id: string, appOutput: any, expected: { label: EvalLabel } }[] = [
    {
      id: "format-001",
      appOutput: {
        motto: "Valid motto",
        colorPalette: {
          textColor: "#FFFFFF",
          backgroundColor: "#000000",
          primary: "#FF0000",
          secondary: "#00FF00"
        }
      },
      expected: {
        label: EvalLabel.PASS
      }
    },
    {
      id: "format-002",
      appOutput: {
        // Missing motto
        colorPalette: {
          textColor: "#FFFFFF",
          backgroundColor: "#000000",
          primary: "#FF0000",
          secondary: "#00FF00"
        }
      },
      expected: {
        label: EvalLabel.FAIL
      }
    },
    {
      id: "format-003",
      appOutput: {
        motto: "", // Empty motto
        colorPalette: {
          textColor: "#FFFFFF",
          backgroundColor: "#000000",
          primary: "#FF0000",
          secondary: "#00FF00"
        }
      },
      expected: {
        label: EvalLabel.FAIL
      }
    },
    {
      id: "format-004",
      appOutput: {
        motto: "Valid motto",
        // Missing colorPalette
      },
      expected: {
        label: EvalLabel.FAIL
      }
    },
    {
      id: "format-005",
      appOutput: {
        motto: "Valid motto",
        colorPalette: {
          textColor: "invalid", // Invalid hex
          backgroundColor: "#000000",
          primary: "#FF0000",
          secondary: "#00FF00"
        }
      },
      expected: {
        label: EvalLabel.FAIL
      }
    },
    {
      id: "format-006",
      appOutput: {
        motto: 123, // Invalid motto type
        colorPalette: {
          textColor: "#FFFFFF",
          backgroundColor: "#000000",
          primary: "#FF0000",
          secondary: "#00FF00"
        }
      },
      expected: {
        label: EvalLabel.FAIL
      }
    },
    {
      id: "format-007",
      appOutput: {
        motto: "One two three four five six seven.", // 7 words max is 6
        colorPalette: {
          textColor: "#FFFFFF",
          backgroundColor: "#000000",
          primary: "#FF0000",
          secondary: "#00FF00"
        }
      },
      expected: {
        label: EvalLabel.FAIL
      }
    },
    {
      id: "format-008",
      appOutput: {
        motto: "Valid motto",
        colorPalette: {
          textColor: "#FFFFFF",
          backgroundColor: "#000000"
          // Missing primary and secondary
        }
      },
      expected: {
        label: EvalLabel.FAIL
      }
    },
    {
      id: "format-009",
      appOutput: {
        motto: "Valid motto",
        colorPalette: {} // Empty object
      },
      expected: {
        label: EvalLabel.FAIL
      }
    },
    {
      id: "format-010",
      appOutput: {
        motto: "Valid motto",
        colorPalette: {
          textColor: "#FFFFFF",
          backgroundColor: "#000000",
          primary: "#FF0000",
          secondary: "#00FF00",
          accent: "#00FFFF" // Additional valid key (catchall)
        }
      },
      expected: {
        label: EvalLabel.PASS
      }
    }
  ];

  const isFast = process.argv.includes('--fast');
  if (isFast) {
    console.log(`\x1b[33m⚠️⚡️ Using FAST MODE. Use this mode only for debugging your evals suite itself. Evaluating only ${TEST_SAMPLE_COUNT_FAST_DEBUG} samples out of the ${testCases.length} available.\x1b[0m\n`);
    testCases = testCases.slice(0, TEST_SAMPLE_COUNT_FAST_DEBUG);
  }

  const verbose = process.argv.includes('--verbose');

  let passed = 0;
  let failed = 0;

  testCases.forEach((testCase) => {
    // Cast to AppOutput to allow passing invalid objects types for testing
    const result = evalDataFormat(testCase.appOutput as AppOutput);
    const actualEvalLabel = result.label;
    const expectedEvalLabel = testCase.expected.label;
    const isSuccess = actualEvalLabel === expectedEvalLabel;

    if (verbose) {
      console.log(`\n-------------------`);
      console.log(`Test Case: ${testCase.id}`);
      console.log(`Input: ${JSON.stringify(testCase.appOutput)}`);
      console.log(`Expected: ${expectedEvalLabel}, Got: ${actualEvalLabel}`);
      console.log(`Rationale: ${result.rationale}`);
      console.log(`Full Result: ${JSON.stringify(result)}`);
    }

    if (isSuccess) {
      passed++;
      if (verbose) {
        console.log(`\x1b[32mPASS\x1b[0m`);
      } else {
        console.log(`[${testCase.id}] \x1b[32mPASS\x1b[0m`);
      }
    } else {
      failed++;
      if (verbose) {
        console.error(`\x1b[31mFAIL\x1b[0m`);
      } else {
        console.error(`[${testCase.id}] \x1b[31mFAIL\x1b[0m`);
      }
    }
  });

  const passResults = `\x1b[32m${passed} PASS\x1b[0m`;
  const failResults = failed > 0
    ? `\x1b[31m${failed} FAIL\x1b[0m`
    : `${failed} FAIL`;

  console.log("\nTEST DONE for format evaluator!");
  console.log("\n📊 RESULTS:")
  console.log(`✅ ${passResults}, ❌ ${failResults}`);

  if (failed > 0) {
    process.exit(1);
  }
}

run();
