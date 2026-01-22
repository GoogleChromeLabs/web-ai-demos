import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WPT_DIR = path.resolve(__dirname, '../tests/wpt');

const CONFIG_FILES = [
  { name: 'FIREBASE_CONFIG', path: '../.env-firebase.json' },
  { name: 'GEMINI_CONFIG', path: '../.env-gemini.json' },
  { name: 'OPENAI_CONFIG', path: '../.env-openai.json' },
];

const injectedConfigs = CONFIG_FILES.map((c) => {
  const fullPath = path.resolve(__dirname, c.path);
  if (fs.existsSync(fullPath)) {
    const content = fs.readFileSync(fullPath, 'utf8');
    return `<script>window.${c.name} = ${content.trim()};</script>`;
  }
  return '';
}).join('\n    ');

console.log('Generating WPT runner files...');
const testFiles = [];

function collectTests(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'resources') {
        collectTests(fullPath);
      }
    } else if (entry.name.endsWith('.window.js')) {
      testFiles.push(path.relative(WPT_DIR, fullPath));
    }
  }
}

collectTests(path.join(WPT_DIR, 'language-model'));

const commonHead = `
    <style>
        body { font-family: sans-serif; line-height: 1.6; max-width: 800px; margin: 2rem auto; padding: 0 1rem; }
        h1 { border-bottom: 2px solid #eee; padding-bottom: 0.5rem; }
        #log { margin-top: 2rem; border: 1px solid #eee; padding: 1rem; border-radius: 4px; }
        ul { padding-left: 1.5rem; }
        li { margin-bottom: 0.5rem; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
    ${injectedConfigs}
    <script src="resources/testharness.js"></script>
    <script>
        setup({ explicit_timeout: true, timeout_multiplier: 10 });
    </script>
    <script src="resources/testharnessreport.js"></script>
    <script src="resources/testdriver.js"></script>
    <script src="resources/testdriver-vendor.js"></script>
    <script src="resources/util.js"></script>
    <script type="module" src="../../async-iterator-polyfill.js"></script>
    <script type="module" src="../../prompt-api-polyfill.js"></script>
    <script>
        if (typeof gc !== 'function') {
            window.gc = () => {
                console.warn('gc() is not available in this environment. Skipping GC.');
            };
        }
    </script>
`;

// 1. Generate all-tests.html (Unified Runner)
const allTestsHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Prompt API WPT Runner - All Tests</title>
    ${commonHead}
</head>
<body>
    <h1>Prompt API WPT Tests (All)</h1>
    <p><a href="index.html">&larr; Back to Index</a></p>
    <p>Running all tests against the polyfill in a single page.</p>
    <div id="log"></div>
    ${testFiles.map((file) => `<script type="module" src="${file}"></script>`).join('\n    ')}
</body>
</html>`;

fs.writeFileSync(path.join(WPT_DIR, 'all-tests.html'), allTestsHtml);
console.log(
  `Generated unified runner: ${path.join(WPT_DIR, 'all-tests.html')}`
);

// 2. Generate individual wrappers
for (const testFile of testFiles) {
  const htmlPath = path.join(WPT_DIR, testFile.replace('.js', '.html'));
  const depth = testFile.split(path.sep).length - 1;
  const prefix = '../'.repeat(depth);
  const resourcePrefix = prefix;
  const polyfillPrefix = prefix + '../../';

  const individualHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>WPT: ${testFile}</title>
    <style>
        body { font-family: sans-serif; line-height: 1.6; max-width: 800px; margin: 2rem auto; padding: 0 1rem; }
        h1 { border-bottom: 2px solid #eee; padding-bottom: 0.5rem; }
        #log { margin-top: 2rem; border: 1px solid #eee; padding: 1rem; border-radius: 4px; }
    </style>
    ${injectedConfigs}
    <script src="${resourcePrefix}resources/testharness.js"></script>
    <script>
        setup({ explicit_timeout: true, timeout_multiplier: 10 });
    </script>
    <script src="${resourcePrefix}resources/testharnessreport.js"></script>
    <script src="${resourcePrefix}resources/testdriver.js"></script>
    <script src="${resourcePrefix}resources/testdriver-vendor.js"></script>
    <script src="${resourcePrefix}resources/util.js"></script>
    <script type="module" src="${polyfillPrefix}async-iterator-polyfill.js"></script>
    <script type="module" src="${polyfillPrefix}prompt-api-polyfill.js"></script>
    <script>
        if (typeof gc !== 'function') {
            window.gc = () => {
                console.warn('gc() is not available in this environment. Skipping GC.');
            };
        }
    </script>
</head>
<body>
    <h1>WPT: ${testFile}</h1>
    <p><a href="${resourcePrefix}index.html">&larr; Back to Index</a></p>
    <div id="log"></div>
    <script type="module" src="${path.basename(testFile)}"></script>
</body>
</html>`;

  fs.writeFileSync(htmlPath, individualHtml);
}
console.log(`Generated ${testFiles.length} individual test wrappers.`);

// 3. Generate index.html (Landing Page)
const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Prompt API WPT Runner</title>
    <style>
        body { font-family: sans-serif; line-height: 1.6; max-width: 800px; margin: 2rem auto; padding: 0 1rem; }
        h1 { border-bottom: 2px solid #eee; padding-bottom: 0.5rem; }
        ul { padding-left: 1.5rem; }
        li { margin-bottom: 0.5rem; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
        .unified { font-weight: bold; margin-bottom: 1.5rem; }
    </style>
</head>
<body>
    <h1>Prompt API WPT Tests</h1>
    
    <div class="unified">
        <a href="all-tests.html">Run All Tests Automatically</a>
    </div>

    <h2>Individual Tests</h2>
    <ul>
        ${testFiles
          .map((testFile) => {
            const htmlLink = testFile.replace('.js', '.html');
            return `<li><a href="${htmlLink}">${testFile}</a></li>`;
          })
          .join('\n        ')}
    </ul>
</body>
</html>`;

fs.writeFileSync(path.join(WPT_DIR, 'index.html'), indexHtml);
console.log(`Generated landing page: ${path.join(WPT_DIR, 'index.html')}`);

// Cleanup old index if it was the unified one (already overwritten but just to be sure)
// Actually we already overwritten it in step 3.

console.log('Done.');
