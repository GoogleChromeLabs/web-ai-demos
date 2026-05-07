/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import dotenv from 'dotenv';
dotenv.config({ quiet: true });
import { evalContrastRatio } from '../src/eval.service';
import { EvalLabel } from '../src/types';
import { CONTRAST_RATIO_MIN } from '../src/app.config';
import { TEST_SAMPLE_COUNT_FAST_DEBUG } from './test.config';

async function run() {
    console.log("\n\n================================");
    console.log("TEST: contrast evaluator");
    console.log("================================");

    console.log("Testing that the contrast evaluation function catches insufficient color contrast ratios...\n")

    let testCases = [
        {
            id: "contrast-001",
            userInput: {
                companyName: "Test Co",
                description: "Test description",
                audience: "Test audience",
                tone: ["Test tone"]
            },
            appOutput: {
                motto: "Test motto",
                colorPalette: {
                    textColor: "#FFFFFF",
                    backgroundColor: "#000000",
                    primary: "#FF0000",
                    secondary: "#333333"
                }
            },
            expected: {
                // White on Black (High Contrast) - PASS
                contrast: EvalLabel.PASS
            }
        },
        {
            id: "contrast-002",
            userInput: {
                companyName: "Test Co",
                description: "Test description",
                audience: "Test audience",
                tone: ["Test tone"]
            },
            appOutput: {
                motto: "Test motto",
                colorPalette: {
                    textColor: "#333333",
                    backgroundColor: "#000000",
                    primary: "#FF0000",
                    secondary: "#333333"
                }
            },
            expected: {
                // Dark Grey on Black (Low Contrast) - FAIL
                contrast: EvalLabel.FAIL
            }
        },
        {
            id: "contrast-003",
            userInput: {
                companyName: "Test Co",
                description: "Test description",
                audience: "Test audience",
                tone: ["Test tone"]
            },
            appOutput: {
                motto: "Test motto",
                colorPalette: {
                    textColor: "#0000FF",
                    backgroundColor: "#FF0000",
                    primary: "#BEBEBE",
                    secondary: "#CCCCCC"
                }
            },
            expected: {
                // Blue on Red (Low Contrast) - FAIL
                contrast: EvalLabel.FAIL
            }
        },
        {
            id: "contrast-004",
            userInput: {
                companyName: "Test Co",
                description: "Test description",
                audience: "Test audience",
                tone: ["Test tone"]
            },
            appOutput: {
                motto: "Test motto",
                colorPalette: {
                    textColor: "#000000",
                    backgroundColor: "#FFFFFF",
                    primary: "#FF0000",
                    secondary: "#CCCCCC"
                }
            },
            expected: {
                // Black on White (High Contrast) - PASS
                contrast: EvalLabel.PASS
            }
        },
        {
            id: "contrast-005",
            userInput: {
                companyName: "Test Co",
                description: "Test description",
                audience: "Test audience",
                tone: ["Test tone"]
            },
            appOutput: {
                motto: "Test motto",
                colorPalette: {
                    textColor: "#FFFF00",
                    backgroundColor: "#FFFFFF",
                    primary: "#FF0000",
                    secondary: "#CCCCCC"
                }
            },
            expected: {
                // Yellow on White (Low Contrast) - FAIL
                contrast: EvalLabel.FAIL
            }
        },
        {
            id: "contrast-006",
            userInput: {
                companyName: "Test Co",
                description: "Test description",
                audience: "Test audience",
                tone: ["Test tone"]
            },
            appOutput: {
                motto: "Test motto",
                colorPalette: {
                    // Missing textColor
                    backgroundColor: "#000000",
                    primary: "#FF0000",
                    secondary: "#CCCCCC"
                }
            },
            expected: {
                contrast: EvalLabel.FAIL
            }
        },
        {
            id: "contrast-007",
            userInput: {
                companyName: "Test Co",
                description: "Test description",
                audience: "Test audience",
                tone: ["Test tone"]
            },
            appOutput: {
                motto: "Test motto",
                colorPalette: {
                    textColor: "invalid",
                    backgroundColor: "#000000",
                    primary: "#FF0000",
                    secondary: "#CCCCCC"
                }
            },
            expected: {
                contrast: EvalLabel.FAIL
            }
        },
        {
            id: "contrast-008",
            userInput: {
                companyName: "Test Co",
                description: "Test description",
                audience: "Test audience",
                tone: ["Test tone"]
            },
            appOutput: {
                motto: "Test motto",
                colorPalette: {
                    textColor: "#fff",
                    backgroundColor: "#000",
                    primary: "#FF0000",
                    secondary: "#CCCCCC"
                }
            },
            expected: {
                // 3-digit hex PASS
                contrast: EvalLabel.PASS
            }
        },
        {
            id: "contrast-009",
            userInput: {
                companyName: "Test Co",
                description: "Test description",
                audience: "Test audience",
                tone: ["Test tone"]
            },
            appOutput: {
                motto: "Test motto",
                colorPalette: {
                    textColor: "#CCCCCC",
                    backgroundColor: "#FFFFFF",
                    primary: "#FF0000",
                    secondary: "#CCCCCC"
                }
            },
            expected: {
                // Light Gray on White - FAIL
                contrast: EvalLabel.FAIL
            }
        },
        {
            id: "contrast-010",
            userInput: {
                companyName: "Test Co",
                description: "Test description",
                audience: "Test audience",
                tone: ["Test tone"]
            },
            appOutput: {
                motto: "Test motto",
                colorPalette: {
                    textColor: "#000080",
                    backgroundColor: "#FFFFFF",
                    primary: "#FF0000",
                    secondary: "#CCCCCC"
                }
            },
            expected: {
                // Navy on White - PASS
                contrast: EvalLabel.PASS
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
        const result = evalContrastRatio(testCase.appOutput.colorPalette as any, CONTRAST_RATIO_MIN);
        const actualEvalLabel = result.label;
        const expectedEvalLabel = testCase.expected.contrast;
        const isSuccess = actualEvalLabel === expectedEvalLabel;

        if (verbose) {
            console.log(`\n-------------------`);
            console.log(`Test Case: ${testCase.id}`);
            console.log(`Input Palette: ${JSON.stringify(testCase.appOutput.colorPalette)}`);
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

    console.log("\nTEST DONE for contrast evaluator!");
    console.log("\n📊 RESULTS:")
    console.log(`✅ ${passResults}, ❌ ${failResults}\n`);

    if (failed > 0) {
        process.exit(1);
    }
}

run();
