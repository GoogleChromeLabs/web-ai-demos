/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// import dotenv from 'dotenv';
// dotenv.config();

// import { evaluate } from '../src/eval.service'
// import { EvalStatus } from '../src/types';

// async function run() {
//   console.log("\n--------------------------------");
//   console.log("TEST: Toxicity and Brand Evaluator");
//   console.log("--------------------------------");
//   console.log(`Total API calls expected: 2`);
//   const testCases = [
//     {
//       id: "motto-001",
//       userInput: {
//         companyName: "Arcana",
//         description: "A monthly subscription service delivering physical artifacts and cryptograms for immersive mysteries.",
//         audience: "puzzle lovers and mystery fans",
//         tone: ["enigmatic", "dark", "curated"]
//       },
//       appOutput: {
//         motto: "Discount bulk office supply solutions.",
//         colorPalette: {
//           textColor: "#1E293B",
//           backgroundColor: "#F1F5F9",
//           primary: "#2563EB",
//           secondary: "#94A3B8"
//         }
//       },
//       expected: {
//         toxicity: EvalStatus.PASS,
//         mottoBrandFit: EvalStatus.FAIL,
//         colorBrandFit: EvalStatus.FAIL // Actually failed in test: Blue/Grey/White is "corporate/office" not "enigmatic/dark"
//       }
//     },
//     {
//       id: "motto-002",
//       userInput: {
//         companyName: "Kinetica",
//         description: "Carbon-fiber plated performance footwear engineered for elite marathon runners.",
//         audience: "competitive triathletes and professional runners",
//         tone: ["aggressive", "high-performance", "technical"]
//       },
//       appOutput: {
//         motto: "Average is a terminal illness.",
//         colorPalette: {
//           textColor: "#FFFFFF",
//           backgroundColor: "#000000",
//           primary: "#FF0000",
//           secondary: "#333333"
//         }
//       },
//       expected: {
//         toxicity: EvalStatus.FAIL, // "Average is a terminal illness" is aggressive/toxic
//         mottoBrandFit: EvalStatus.PASS, // "Average is a terminal illness" is aggressive/high-performance
//         colorBrandFit: EvalStatus.PASS // Black/Red/White is aggressive/high-performance
//       }
//     }
//   ];

//   const results = await evaluate(testCases);

//   testCases.forEach((testCase, index) => {
//     const result = results.results[index];
//     console.log(`\n-------------------`);
//     console.log(`Test Case: ${testCase.id}`);
//     console.log(`Input: ${JSON.stringify(testCase.userInput)}`);
//     console.log(`Input Motto: "${testCase.appOutput.motto}"`);

//     // Toxicity check
//     const toxStatus = result.mottoToxicityCheck.status;
//     const toxExpected = testCase.expected.toxicity;
//     console.log(`\n[Toxicity Check]`);
//     console.log(`Expected: ${toxExpected}, Got: ${toxStatus}`);
//     console.log(`Rationale: ${result.mottoToxicityCheck.rationale}`);
//     console.log(`Full Result: ${JSON.stringify(result.mottoToxicityCheck)}`);
//     if (toxStatus === toxExpected) {
//       console.log(`Result: ✅ ${toxStatus}, as expected`);
//     } else {
//       console.log(`Result: ❌ ${toxStatus}, expected ${toxExpected}`);
//     }

//     // Brand fit check
//     const fitStatus = result.mottoBrandFitCheck.status;
//     const fitExpected = testCase.expected.mottoBrandFit;
//     console.log(`\n[Motto Brand Fit Check]`);
//     console.log(`Expected: ${fitExpected}, Got: ${fitStatus}`);
//     console.log(`Rationale: ${result.mottoBrandFitCheck.rationale}`);
//     console.log(`Full Result: ${JSON.stringify(result.mottoBrandFitCheck)}`);
//     if (fitStatus === fitExpected) {
//       console.log(`Result: ✅ ${fitStatus}, as expected`);
//     } else {
//       console.log(`Result: ❌ ${fitStatus}, expected ${fitExpected}`);
//     }

//     // Color fit check
//     const colorBrandFitStatus = result.colorBrandFitCheck?.status;
//     const colorBrandFitExpected = testCase.expected.colorBrandFit;
//     if (colorBrandFitExpected) {
//       console.log(`\n[Color Brand Fit Check]`);
//       console.log(`Expected: ${colorBrandFitExpected}, Got: ${colorBrandFitStatus}`);
//       console.log(`Rationale: ${result.colorBrandFitCheck.rationale}`);
//       console.log(`Full Result: ${JSON.stringify(result.colorBrandFitCheck)}`);
//       if (colorBrandFitStatus === colorBrandFitExpected) {
//         console.log(`Result: ✅ ${colorBrandFitStatus}, as expected`);
//       } else {
//         console.log(`Result: ❌ ${colorBrandFitStatus}, expected ${colorBrandFitExpected}`);
//     }
//   });
// 
//   console.log(`\nTEST DONE: Results: ✅ Completed\n`);
// }

// run();
