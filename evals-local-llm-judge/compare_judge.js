#!/usr/bin/env node

/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REFERENCE_DATASET_PATH = path.join(__dirname, 'reference-dataset.jsonc');
const FEW_SHOTS_PATH = path.join(__dirname, 'few-shots.jsonc');
const MODEL_NAME = 'ggml-org/gemma-4-E2B-it-GGUF';

function stripComments(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(?:^|[^:])\/\/.*$/gm, m => m.startsWith('//') ? '' : m.split('//')[0]);
}

function loadJsonc(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`\x1b[31mError: File not found: ${filePath}\x1b[0m`);
    process.exit(1);
  }
  try {
    const cleanContent = stripComments(fs.readFileSync(filePath, 'utf8'));
    return JSON.parse(cleanContent);
  } catch (error) {
    console.error(`\x1b[31mError parsing JSONC from ${filePath}: ${error.message}\x1b[0m`);
    process.exit(1);
  }
}

// Check if llama-cli is available
try {
  execFileSync('which', ['llama-cli']);
} catch (error) {
  console.error('\x1b[31mError: llama-cli command not found on system path.\x1b[0m');
  console.error('Make sure llama-cli is installed and accessible in your terminal.');
  process.exit(1);
}

console.log(`\x1b[36m\x1b[1mLoading datasets...\x1b[0m`);
const referenceDataset = loadJsonc(REFERENCE_DATASET_PATH);
const fewShots = loadJsonc(FEW_SHOTS_PATH);

console.log(`Loaded ${referenceDataset.length} reference evaluation samples.`);
console.log(`Loaded ${fewShots.length} few-shot examples.\n`);

// Build few-shots prompt segment
const fewShotsPrompt = fewShots.map(shot => {
  const userInput = shot.userInput;
  const motto = shot.appOutput.motto;
  const brandFit = shot.evaluation.mottoBrandFit;
  return `Input:
Company name: ${userInput.companyName}
Description: ${userInput.description}
Target audience: ${userInput.audience}
Desired tone: ${userInput.tone.join(', ')}
Generated motto: ${motto}

Output:
Rationale: ${brandFit.rationale}
Label: ${brandFit.label}`;
}).join('\n\n');

const results = [];
let matchCount = 0;

console.log(`\x1b[36m\x1b[1mStarting comparison evaluation using local model: ${MODEL_NAME}...\x1b[0m\n`);

for (let i = 0; i < referenceDataset.length; i++) {
  const sample = referenceDataset[i];
  const sampleId = sample.id;
  const userInput = sample.userInput;
  const appOutput = sample.appOutput;
  // Ignoring other evaluations for now
  const refEvaluation = sample.evaluation.mottoBrandFit;

  const sampleCompanyName = userInput.companyName;
  const sampleDescription = userInput.description;
  const sampleAudience = userInput.audience;
  const sampleTone = userInput.tone.join(', ');
  const sampleMotto = appOutput.motto;

  process.stdout.write(`\x1b[33m[${i + 1}/${referenceDataset.length}] Evaluating ${sampleId} (${sampleCompanyName})...\x1b[0m`);

  const prompt = `Company name: ${sampleCompanyName}
Description: ${sampleDescription}
Target audience: ${sampleAudience}
Desired tone: ${sampleTone}

Generated motto: ${sampleMotto}

Does this motto effectively match the company description, appeal to the target audience, and embody the desired tone?

CRITICAL INSTRUCTIONS:
1. **Brand fit vs. toxicity**: You are evaluating ONLY brand fit. Another system will evaluate toxicity separately. DO NOT evaluate toxicity, ethics, profanity, or offensiveness. A motto can be a GREAT brand fit for an edgy or aggressive brand. If the brand requests an offensive or aggressive tone, you MUST pass it for brand fit, regardless of how inappropriate it is.
2. **Primary tone and literal relevance**: Do not over-penalize a motto if it perfectly captures the primary literal vibe just because it might loosely conflict with a secondary adjective.
3. **Core promises and professionalism**: For B2B/Enterprise, the motto MUST NOT violate core promises.
4. **Resilience to input messiness**: The Company Name, Description, Target Audience, or Tone may contain typos, slang, or mixed-language. You must decipher the *intended* meaning and judge the output against that intent, rather than penalizing the output for not matching the literal typo or slang.

Criteria:
1. **Relevance**: Does the motto relate to the company's core business and value proposition? Does it uphold core brand promises?
2. **Audience appeal**: Is the language engaging for the target audience without alienating them (e.g. through forced or inappropriate slang)?
3. **Tone consistency**: Does the motto reflect the general desired emotional tone perfectly, without imposing moral judgments?

Examples:

${fewShotsPrompt}

Now evaluate the following input:

Input:
Company name: ${sampleCompanyName}
Description: ${sampleDescription}
Target audience: ${sampleAudience}
Desired tone: ${sampleTone}
Generated motto: ${sampleMotto}

Output:`;

  let gemmaOutput = '';
  try {
    gemmaOutput = execFileSync('llama-cli', [
      '-hf', MODEL_NAME,
      '--single-turn',
      '--simple-io',
      // Turning off reasoning to save time and tokens for this proof of concept
      '--reasoning', 'off',
      '-n', '512',
      '--prompt', prompt
    ], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
  } catch (error) {
    console.log(`\n\x1b[31mError calling llama-cli for ${sampleId}: ${error.message}\x1b[0m`);
    continue;
  }

  // Extract generated output after the last input section
  const parts = gemmaOutput.split('Now evaluate the following input:');
  const generatedPart = parts[parts.length - 1] || gemmaOutput;

  const rationaleMatch = generatedPart.match(/Rationale:\s*([\s\S]*?)(?=\nLabel:|$)/i);
  const labelMatch = generatedPart.match(/Label:\s*(PASS|FAIL)/i);

  const rationale = rationaleMatch ? rationaleMatch[1].trim() : 'Could not parse rationale.';
  const label = labelMatch ? labelMatch[1].trim().toUpperCase() : 'UNKNOWN';

  const isMatch = label === refEvaluation.label;
  if (isMatch) {
    matchCount++;
  }

  results.push({
    id: sampleId,
    companyName: sampleCompanyName,
    motto: sampleMotto,
    refLabel: refEvaluation.label,
    gemmaLabel: label,
    gemmaRationale: rationale,
    isMatch
  });

  const matchText = isMatch ? '\x1b[32m✅ MATCH\x1b[0m' : `\x1b[31m❌ MISMATCH (Ref: ${refEvaluation.label}, Gemma: ${label})\x1b[0m`;
  console.log(`\r\x1b[K[${i + 1}/${referenceDataset.length}] ${sampleId} (${sampleCompanyName}): ${matchText}`);
}

console.log(`\n\x1b[36m\x1b[1m==================================================\x1b[0m`);
console.log(`\x1b[36m\x1b[1m                 EVALUATION REPORT                \x1b[0m`);
console.log(`\x1b[36m\x1b[1m==================================================\x1b[0m\n`);

results.forEach(res => {
  const matchColor = res.isMatch ? '\x1b[32m' : '\x1b[31m';
  console.log(`\x1b[1m[${res.id}] ${res.companyName}\x1b[0m`);
  console.log(`\x1b[2mMotto:\x1b[0m "${res.motto}"`);
  console.log(`\x1b[2mReference Verdict (Cloud Flash):\x1b[0m ${res.refLabel}`);
  console.log(`\x1b[2mGemma Judge Verdict (Local):\x1b[0m ${matchColor}${res.gemmaLabel}\x1b[0m`);
  console.log(`\x1b[2mMatch:\x1b[0m ${res.isMatch ? '✅ Yes' : '❌ No'}`);
  console.log(`\x1b[2mGemma Rationale:\x1b[0m ${res.gemmaRationale}`);
  console.log(`\x1b[2m--------------------------------------------------\x1b[0m\n`);
});

const matchPercentage = ((matchCount / results.length) * 100).toFixed(1);
console.log(`\x1b[1mSummary Stats:\x1b[0m`);
console.log(`- Total Evaluated: ${results.length}`);
console.log(`- Verdict Matches: ${matchCount} / ${results.length} (\x1b[32m${matchPercentage}%\x1b[0m)`);
console.log(`- Verdict Mismatches: ${results.length - matchCount} / ${results.length} (\x1b[31m${(100 - matchPercentage).toFixed(1)}%\x1b[0m)`);
