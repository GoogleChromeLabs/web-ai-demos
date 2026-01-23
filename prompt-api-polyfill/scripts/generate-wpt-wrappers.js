import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WPT_DIR = path.resolve(__dirname, '../tests/wpt');

const backendsDir = path.resolve(__dirname, '../backends');
const backendFiles = fs
  .readdirSync(backendsDir)
  .filter(
    (file) =>
      file.endsWith('.js') && file !== 'base.js' && file !== 'defaults.js'
  );

const allBackends = backendFiles.map((file) => {
  const name = file.replace('.js', '');
  return {
    name,
    configKey: `${name.toUpperCase()}_CONFIG`,
    file: `.env-${name}.json`,
  };
});

const backendConfigs = {};
allBackends.forEach((b) => {
  const fullPath = path.resolve(__dirname, '../', b.file);
  if (fs.existsSync(fullPath)) {
    backendConfigs[b.configKey] = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  }
});

// Helper to get injected config for a specific backend or default
function getInjectedConfig(backendKey = null) {
  const configs = backendKey
    ? { [backendKey]: backendConfigs[backendKey] }
    : backendConfigs;

  return `
    <script>
        ${Object.entries(configs)
          .map(([key, value]) => `window.${key} = ${JSON.stringify(value)};`)
          .join('\n        ')}
    </script>
`;
}

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

const blessScript = `
    <script>
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE && node.id?.startsWith('wpt-test-driver-bless-')) {
                        console.log('Automatically clicking bless button:', node.id);
                        node.click();
                    }
                }
            }
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
    </script>
`;

function getCommonHead(backendKey = null, polyfillPrefix = '../../') {
  return `
    <style>
        body { font-family: sans-serif; line-height: 1.6; max-width: 800px; margin: 2rem auto; padding: 0 1rem; }
        h1 { border-bottom: 2px solid #eee; padding-bottom: 0.5rem; }
        #log { margin-top: 2rem; border: 1px solid #eee; padding: 1rem; border-radius: 4px; }
        ul { padding-left: 1.5rem; }
        li { margin-bottom: 0.5rem; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
    ${getInjectedConfig(backendKey)}
    <script src="resources/testharness.js"></script>
    <script>
        setup({ explicit_timeout: true, timeout_multiplier: 10 });
    </script>
    <script src="resources/testharnessreport.js"></script>
    <script src="resources/testdriver.js"></script>
    <script src="resources/testdriver-vendor.js"></script>
    <script src="resources/util.js"></script>
    <script type="module" src="${polyfillPrefix}async-iterator-polyfill.js"></script>
    <script type="module" src="${polyfillPrefix}prompt-api-polyfill.js"></script>
    <script>
        if (typeof gc !== 'function') {
            window.gc = () => {
                console.warn('gc() is not available in this environment. Skipping GC.');
            };
        }
    </script>
    ${blessScript}
`;
}

// 1. Generate per-backend all-tests-[backend].html
const runnerFiles = [];
Object.keys(backendConfigs).forEach((backendKey) => {
  const backendName = backendKey.replace('_CONFIG', '').toLowerCase();
  const runnerFileName = `all-tests-${backendName}.html`;
  runnerFiles.push({ name: backendName.toUpperCase(), file: runnerFileName });

  const runnerHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Prompt API WPT Runner - All Tests (${backendName.toUpperCase()})</title>
    ${getCommonHead(backendKey, '../../')}
</head>
<body>
    <h1>Prompt API WPT Tests (${backendName.toUpperCase()})</h1>
    <p><a href="index.html">&larr; Back to Index</a></p>
    <p>Running all tests against the polyfill with <strong>${backendName.toUpperCase()}</strong> backend.</p>
    <div id="log"></div>
    ${testFiles.map((file) => `<script type="module" src="${file}"></script>`).join('\n    ')}
</body>
</html>`;

  fs.writeFileSync(path.join(WPT_DIR, runnerFileName), runnerHtml);
  console.log(`Generated runner: ${path.join(WPT_DIR, runnerFileName)}`);
});

// 2. Generate individual wrappers for EACH test for EACH backend
const allIndividualTestPermutations = {}; // testFile -> { backendName -> htmlLink }

for (const backendKey of Object.keys(backendConfigs)) {
  const backendName = backendKey.replace('_CONFIG', '').toLowerCase();

  for (const testFile of testFiles) {
    const htmlFileName = testFile.replace('.js', `.${backendName}.html`);
    const htmlPath = path.join(WPT_DIR, htmlFileName);
    const depth = testFile.split(path.sep).length - 1;
    const prefix = '../'.repeat(depth);
    const resourcePrefix = prefix;
    const polyfillPrefix = prefix + '../../';

    const individualHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>WPT (${backendName.toUpperCase()}): ${testFile}</title>
    <style>
        body { font-family: sans-serif; line-height: 1.6; max-width: 800px; margin: 2rem auto; padding: 0 1rem; }
        h1 { border-bottom: 2px solid #eee; padding-bottom: 0.5rem; }
        #log { margin-top: 2rem; border: 1px solid #eee; padding: 1rem; border-radius: 4px; }
    </style>
    ${getInjectedConfig(backendKey)}
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
    ${blessScript}
</head>
<body>
    <h1>WPT (${backendName.toUpperCase()}): ${testFile}</h1>
    <p><a href="${resourcePrefix}index.html">&larr; Back to Index</a></p>
    <div id="log"></div>
    <script type="module" src="${path.basename(testFile)}"></script>
</body>
</html>`;

    fs.writeFileSync(htmlPath, individualHtml);

    if (!allIndividualTestPermutations[testFile]) {
      allIndividualTestPermutations[testFile] = {};
    }
    allIndividualTestPermutations[testFile][backendName] = htmlFileName;
  }
}
console.log(
  `Generated ${testFiles.length * Object.keys(backendConfigs).length} individual test wrappers.`
);

// 3. Generate index.html (Landing Page)
const backendNames = Object.keys(backendConfigs).map((k) =>
  k.replace('_CONFIG', '').toLowerCase()
);

const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Prompt API WPT Runner</title>
    <style>
        body { font-family: sans-serif; line-height: 1.6; max-width: 1200px; margin: 2rem auto; padding: 0 1rem; }
        h1 { border-bottom: 2px solid #eee; padding-bottom: 0.5rem; }
        ul { padding-left: 1.5rem; }
        li { margin-bottom: 0.5rem; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
        .runners { border: 1px solid #eee; padding: 1rem; border-radius: 4px; background: #fafafa; margin-bottom: 2rem; }
        .runners h2 { margin-top: 0; }
        table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
        th, td { text-align: left; padding: 0.75rem; border-bottom: 1px solid #eee; }
        th { background: #f4f4f4; text-transform: uppercase; font-size: 0.85rem; }
        tr:hover { background: #fcfcfc; }
        .test-name { font-family: monospace; font-size: 0.9rem; }
    </style>
</head>
<body>
    <h1>Prompt API WPT Tests</h1>
    
    <div class="runners">
        <h2>Batch Runners</h2>
        <p>Run all tests for a specific backend:</p>
        <ul>
            ${runnerFiles
              .map(
                (r) =>
                  `<li><a href="${r.file}">Run All Tests (<strong>${r.name}</strong>)</a></li>`
              )
              .join('\n            ')}
        </ul>
    </div>

    <h2>Test Matrix</h2>
    <p>Run individual tests with a specific backend:</p>
    <table>
        <thead>
            <tr>
                <th>Test File</th>
                ${backendNames.map((name) => `<th>${name.toUpperCase()}</th>`).join('')}
            </tr>
        </thead>
        <tbody>
            ${testFiles
              .map(
                (testFile) => `
                <tr>
                    <td class="test-name">${testFile}</td>
                    ${backendNames
                      .map((backendName) => {
                        const link =
                          allIndividualTestPermutations[testFile][backendName];
                        return `<td><a href="${link}">Run</a></td>`;
                      })
                      .join('')}
                </tr>
            `
              )
              .join('')}
        </tbody>
    </table>
</body>
</html>`;

fs.writeFileSync(path.join(WPT_DIR, 'index.html'), indexHtml);
console.log(
  `Generated landing page matrix: ${path.join(WPT_DIR, 'index.html')}`
);

console.log('Done.');
