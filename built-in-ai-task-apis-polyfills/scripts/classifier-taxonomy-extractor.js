/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';

const TAXONOMY_URL =
  'https://raw.githubusercontent.com/InteractiveAdvertisingBureau/Taxonomies/develop/Content%20Taxonomies/Content%20Taxonomy%203.1.tsv';
const OUTPUT_FILE = path.join(process.cwd(), 'classifier-prompt-builder.js');

async function fetchTaxonomy() {
  console.log(`Fetching taxonomy from ${TAXONOMY_URL}...`);
  const response = await fetch(TAXONOMY_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch taxonomy: ${response.statusText}`);
  }
  return await response.text();
}

function parseTSV(tsv) {
  const lines = tsv.trim().split('\n');
  const dataLines = lines.slice(1);
  const taxonomy = {};

  for (const line of dataLines) {
    const [id, parent, name, t1, t2, t3, t4] = line.split('\t'); // eslint-disable-line no-unused-vars
    if (!id) {
      continue;
    }

    const tiers = [t1, t2, t3, t4].filter((t) => t && t.trim() !== '');
    taxonomy[id] = tiers.map((t) => t.trim()).join(' > ');
  }
  return taxonomy;
}

function updateBuilder(taxonomyData) {
  let content = fs.readFileSync(OUTPUT_FILE, 'utf8');

  const startMarker = '// --- START TAXONOMY DATA ---';
  const endMarker = '// --- END TAXONOMY DATA ---';

  const startIndex = content.indexOf(startMarker);
  const endIndex = content.indexOf(endMarker);

  if (startIndex === -1 || endIndex === -1) {
    // If markers don't exist, we might be doing a first-time setup or the file structure changed.
    // Let's try to find static #taxonomyData = ...
    const regex = /static #taxonomyData = \{[\s\S]*?\};/;
    const newData = `static #taxonomyData = ${JSON.stringify(taxonomyData, null, 2)};`;

    if (regex.test(content)) {
      content = content.replace(
        regex,
        `${startMarker}\n  ${newData}\n  ${endMarker}`
      );
    } else {
      throw new Error(
        'Could not find #taxonomyData in classifier-prompt-builder.js'
      );
    }
  } else {
    const newData = `${startMarker}\n  static #taxonomyData = ${JSON.stringify(taxonomyData, null, 2)};\n  ${endMarker}`;
    content =
      content.slice(0, startIndex) +
      newData +
      content.slice(endIndex + endMarker.length);
  }

  fs.writeFileSync(OUTPUT_FILE, content);
  console.log(
    'Successfully updated classifier-prompt-builder.js with the latest taxonomy data.'
  );
}

async function run() {
  try {
    const tsv = await fetchTaxonomy();
    const taxonomy = parseTSV(tsv);
    updateBuilder(taxonomy);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

run();
