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

const files = execSync(`find . -not -path '*/.*' -not -path './node_modules/*' -not -path '*/node_modules/*' -not -path './dist/*' -not -path '*/dist/*' -not -path './build/*' -not -path '*/build/*' -not -path './tests/*' -not -path '*/tests/*' -not -path './scripts/*' \\( -name "*.js" -o -name "*.ts" -o -name "*.css" -o -name "*.html" -o -name "*.jsx" -o -name "*.tsx" \\) -type f -exec grep -L "SPDX-License-Identifier: Apache-2.0" {} +`)
  .toString()
  .trim()
  .split('\n')
  .filter(f => f.length > 0);

console.log(`Found ${files.length} files to process.`);

files.forEach(file => {
  const ext = path.extname(file);
  const content = fs.readFileSync(file, 'utf8');
  let header = '';

  if (['.js', '.ts', '.css', '.jsx', '.tsx'].includes(ext)) {
    header = JS_HEADER;
  } else if (['.html'].includes(ext)) {
    header = HTML_HEADER;
  }

  if (header) {
    console.log(`Adding header to: ${file}`);
    fs.writeFileSync(file, header + content, 'utf8');
  } else {
    console.warn(`No header defined for extension ${ext}: ${file}`);
  }
});

console.log('Done!');
