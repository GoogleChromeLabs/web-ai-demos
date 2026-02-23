/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const currentYear = new Date().getFullYear();

const JS_HEADER = `/**
 * Copyright ${currentYear} Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

`;

const HTML_HEADER = `<!--
  Copyright ${currentYear} Google LLC
  SPDX-License-Identifier: Apache-2.0
-->
`;

const findCommand = `find . -not -path '*/.*' -not -path './node_modules/*' -not -path '*/node_modules/*' -not -path './dist/*' -not -path '*/dist/*' -not -path './build/*' -not -path '*/build/*' -not -path './tests/*' -not -path '*/tests/*' -not -path './scripts/*' \\( -name "*.js" -o -name "*.ts" -o -name "*.css" -o -name "*.html" -o -name "*.jsx" -o -name "*.tsx" \\) -type f`;
const files = execSync(findCommand).toString().trim().split('\n').filter(f => f.length > 0);

console.log(`Found ${files.length} candidate files.`);

let processedCount = 0;

files.forEach(file => {
  const content = fs.readFileSync(file, 'utf8');
  if (content.includes('SPDX-License-Identifier: Apache-2.0')) {
    return;
  }

  const ext = path.extname(file);
  let header = '';

  if (['.js', '.ts', '.css', '.jsx', '.tsx'].includes(ext)) {
    header = JS_HEADER;
  } else if (['.html'].includes(ext)) {
    header = HTML_HEADER;
  }

  if (header) {
    console.log(`Adding header to: ${file}`);
    fs.writeFileSync(file, header + content, 'utf8');
    processedCount++;
  } else {
    console.warn(`No header defined for extension ${ext}: ${file}`);
  }
});

console.log(`Processed ${processedCount} files.`);

console.log('Done!');
