import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const WPT_DIR = path.join(ROOT_DIR, 'tests', 'wpt');
const PROMPT_API_POLYFILL_DIR = path.resolve(
  ROOT_DIR,
  '..',
  'prompt-api-polyfill'
);

// Configuration scanning from prompt-api-polyfill
const backendsDir = path.resolve(PROMPT_API_POLYFILL_DIR, 'backends');
const backendFiles = fs.existsSync(backendsDir)
  ? fs
      .readdirSync(backendsDir)
      .filter(
        (file) =>
          file.endsWith('.js') && file !== 'base.js' && file !== 'defaults.js'
      )
  : [];

const allBackends = backendFiles.map((file) => {
  const name = file.replace('.js', '');
  return {
    name,
    configKey: `${name.toUpperCase()}_CONFIG`,
    file: `.env-${name}.json`,
  };
});

const backendConfigs = {};

// Also support the local .env.json (which we treat as FIREBASE_CONFIG by default if it's there)
const localEnvFile = path.join(ROOT_DIR, '.env.json');
if (fs.existsSync(localEnvFile)) {
  backendConfigs['FIREBASE_CONFIG'] = JSON.parse(
    fs.readFileSync(localEnvFile, 'utf8')
  );
}

allBackends.forEach((b) => {
  const fullPath = path.resolve(PROMPT_API_POLYFILL_DIR, b.file);
  if (fs.existsSync(fullPath)) {
    backendConfigs[b.configKey] = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  }
});

function getInjectedConfig(backendKey = null) {
  const configs =
    backendKey && backendConfigs[backendKey]
      ? { [backendKey]: backendConfigs[backendKey] }
      : backendConfigs;

  return `
    <script>
        window.__FORCE_SUMMARIZER_POLYFILL__ = true;
        window.__FORCE_WRITER_POLYFILL__ = true;
        window.__FORCE_REWRITER_POLYFILL__ = true;
        window.__FORCE_LANGUAGE_DETECTOR_POLYFILL__ = true;
        window.__FORCE_PROMPT_API_POLYFILL__ = true;
        ${Object.entries(configs)
          .map(([key, value]) => `window.${key} = ${JSON.stringify(value)};`)
          .join('\n        ')}
    </script>
`;
}

const blessScript = `
    <script>
        const setupBlessObserver = (win) => {
            try {
                if (!win || !win.document || win.__blessObserverSet) return;
                win.__blessObserverSet = true;
                const observer = new MutationObserver((mutations) => {
                    for (const mutation of mutations) {
                        for (const node of mutation.addedNodes) {
                            if (node.nodeType === Node.ELEMENT_NODE) {
                                if (node.id?.startsWith('wpt-test-driver-bless-')) {
                                    console.log('Automatically clicking bless button in', win.location.href, ':', node.id);
                                    node.click();
                                }
                                if (node.tagName === 'IFRAME') {
                                    setupBlessObserver(node.contentWindow);
                                }
                            }
                        }
                    }
                });
                observer.observe(win.document.documentElement, { childList: true, subtree: true });
                
                // Also check existing ones
                win.document.querySelectorAll('[id^="wpt-test-driver-bless-"]').forEach(button => {
                   console.log('Automatically clicking existing bless button in', win.location.href, ':', button.id);
                   button.click();
                });
                win.document.querySelectorAll('iframe').forEach(iframe => {
                    setupBlessObserver(iframe.contentWindow);
                    iframe.addEventListener('load', () => setupBlessObserver(iframe.contentWindow), { once: false });
                });
            } catch (e) {
                // Ignore cross-origin errors
            }
        };
        setupBlessObserver(window);
    </script>
`;

function getCommonHead(depth = 0, backendKey = null) {
  const prefix = '../'.repeat(depth);
  const resourcePrefix = prefix;
  const polyfillPrefix = prefix + '../../';

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
    <script src="${resourcePrefix}resources/testharness.js"></script>
    <script>
        setup({ explicit_timeout: true, timeout_multiplier: 10 });
    </script>
    <script src="${resourcePrefix}resources/testharnessreport.js"></script>
    <script src="${resourcePrefix}resources/testdriver.js"></script>
    <script src="${resourcePrefix}resources/testdriver-vendor.js"></script>
    <script src="${resourcePrefix}resources/util.js"></script>
    <script type="module" src="${polyfillPrefix}summarizer-api-polyfill.js"></script>
    <script type="module" src="${polyfillPrefix}writer-api-polyfill.js"></script>
    <script type="module" src="${polyfillPrefix}rewriter-api-polyfill.js"></script>
    <script type="module" src="${polyfillPrefix}language-detector-api-polyfill.js"></script>
    <script>
        if (typeof gc !== 'function') {
            window.gc = () => {
                console.warn('gc() is not available in this environment. Skipping GC.');
            };
        }
        window.garbageCollect = window.gc;
    </script>
    ${blessScript}
`;
}

console.log('Generating WPT runner files...');
const apis = ['summarizer', 'writer', 'rewriter', 'language-detection'];
const apiTests = {
  summarizer: [],
  writer: [],
  rewriter: [],
  'language-detection': [],
};

function parseMetaScripts(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const scripts = [];
  const lines = content.split('\n');
  for (const line of lines) {
    const match = line.match(/\/\/\s*META:\s*script=([^\s]+)/);
    if (match) {
      scripts.push(match[1]);
    }
  }
  return scripts;
}

function resolveScriptPath(testFile, scriptPath) {
  if (scriptPath.startsWith('/')) {
    // Relative to WPT_DIR
    const depth = testFile.split(path.sep).length - 1;
    return '../'.repeat(depth) + scriptPath.substring(1);
  }
  // Relative to test file
  return scriptPath;
}

function collectTests(dir, api) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'resources') {
        collectTests(fullPath, api);
      }
    } else if (entry.name.endsWith('.window.js')) {
      const relativePath = path.relative(WPT_DIR, fullPath);
      const scripts = parseMetaScripts(fullPath);
      apiTests[api].push({
        file: relativePath,
        scripts,
      });
    }
  }
}

apis.forEach((api) => {
  const apiDir = path.join(WPT_DIR, api);
  if (fs.existsSync(apiDir)) {
    collectTests(apiDir, api);
  }
});

const activeBackends = Object.keys(backendConfigs);

// 1. Generate individual wrappers FOR EACH BACKEND
const apiBackendTests = {}; // api -> [ { testFile, backendName, htmlFileName } ]

for (const api of apis) {
  apiBackendTests[api] = [];
  for (const testInfo of apiTests[api]) {
    const testFile = testInfo.file;
    for (const backendKey of activeBackends) {
      const backendName = backendKey.replace('_CONFIG', '').toLowerCase();
      const htmlFileName = testFile.replace('.js', `.${backendName}.html`);
      const htmlPath = path.join(WPT_DIR, htmlFileName);
      const depth = testFile.split(path.sep).length - 1;

      // Filter out scripts already in common head
      const resourcePrefix = '../'.repeat(depth);
      const commonResolved = [
        'resources/testharness.js',
        'resources/testharnessreport.js',
        'resources/testdriver.js',
        'resources/testdriver-vendor.js',
        'resources/util.js'
      ].map(s => resourcePrefix + s);

      const extraScripts = testInfo.scripts
        .filter(s => {
          const resolved = resolveScriptPath(testFile, s);
          return !commonResolved.includes(resolved);
        })
        .map(s => `<script src="${resolveScriptPath(testFile, s)}"></script>`)
        .join('\n    ');

      const individualHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>WPT (${backendName.toUpperCase()}): ${testFile}</title>
    ${getCommonHead(depth, backendKey)}
    ${extraScripts}
</head>
<body>
    <h1>WPT (${backendName.toUpperCase()}): ${testFile}</h1>
    <p><a href="${'../'.repeat(depth - 1)}index.html">&larr; Back to API Index</a></p>
    <div id="log"></div>
    <script type="module" src="${path.basename(testFile)}"></script>
</body>
</html>`;

      fs.writeFileSync(htmlPath, individualHtml);
      apiBackendTests[api].push({ testFile, backendName, htmlFileName });
    }
  }
}

// 2. Generate per-API all-tests.html and index.html
for (const api of apis) {
  const apiDir = path.join(WPT_DIR, api);
  if (!fs.existsSync(apiDir)) {
    continue;
  }

  // Generate all-tests-[backend].html for each backend
  for (const backendKey of activeBackends) {
    const backendName = backendKey.replace('_CONFIG', '').toLowerCase();
    const allTestsFileName = `all-tests-${backendName}.html`;

    const allTestsHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>All ${api.toUpperCase()} WPT Tests (${backendName.toUpperCase()})</title>
    ${getCommonHead(1, backendKey)}
</head>
<body>
    <h1>All ${api.toUpperCase()} WPT Tests (${backendName.toUpperCase()})</h1>
    <p><a href="index.html">&larr; Back to Index</a></p>
    <div id="log"></div>
    ${apiTests[api].map((testInfo) => {
      const testFile = testInfo.file;
      const extraScripts = testInfo.scripts
        .filter(s => {
          // Let's resolve everything relative to WPT_DIR for comparison
          const absoluteResolved = s.startsWith('/')
            ? s.substring(1)
            : path.join(path.dirname(testFile), s);

          const commonPaths = [
            'resources/testharness.js',
            'resources/testharnessreport.js',
            'resources/testdriver.js',
            'resources/testdriver-vendor.js',
            'resources/util.js'
          ];
          return !commonPaths.includes(absoluteResolved);
        })
        .map(s => {
          if (s.startsWith('/')) return '..' + s;
          // Path relative to apiDir (e.g., 'language-detection')
          const relDir = path.relative(api, path.dirname(testFile));
          return `<script src="${path.join(relDir, s)}"></script>`;
        })
        .join('\n    ');
      return `${extraScripts}\n    <script type="module" src="${path.relative(api, testFile)}"></script>`;
    }).join('\n    ')}
</body>
</html>`;

    fs.writeFileSync(path.join(apiDir, allTestsFileName), allTestsHtml);
  }

  // Generate index.html with matrix
  const backendNames = activeBackends.map((k) =>
    k.replace('_CONFIG', '').toLowerCase()
  );
  const apiIndexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>${api.toUpperCase()} WPT Runner</title>
    <style>
        body { font-family: sans-serif; line-height: 1.6; max-width: 1200px; margin: 2rem auto; padding: 0 1rem; }
        h1 { border-bottom: 2px solid #eee; padding-bottom: 0.5rem; }
        a { color: #0066cc; text-decoration: none; }
        a:hover { text-decoration: underline; }
        table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
        th, td { text-align: left; padding: 0.75rem; border-bottom: 1px solid #eee; }
        th { background: #f4f4f4; text-transform: uppercase; font-size: 0.85rem; }
        tr:hover { background: #fcfcfc; }
        .test-name { font-family: monospace; font-size: 0.9rem; }
    </style>
</head>
<body>
    <h1>${api.toUpperCase()} WPT Tests</h1>
    <p><a href="../index.html">&larr; Back to Root Index</a></p>
    
    <h3>Batch Runners</h3>
    <ul>
        ${activeBackends
          .map((k) => {
            const name = k.replace('_CONFIG', '');
            return `<li><a href="all-tests-${name.toLowerCase()}.html">Run All Tests (<strong>${name}</strong>)</a></li>`;
          })
          .join('')}
    </ul>

    <h3>Test Matrix</h3>
    <table>
        <thead>
            <tr>
                <th>Test File</th>
                ${backendNames.map((name) => `<th>${name.toUpperCase()}</th>`).join('')}
            </tr>
        </thead>
        <tbody>
            ${apiTests[api]
              .map(
                (testInfo) => `
                <tr>
                    <td class="test-name">${path.basename(testInfo.file)}</td>
                    ${backendNames
                      .map((backendName) => {
                        const link = path
                          .basename(testInfo.file)
                          .replace('.js', `.${backendName}.html`);
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

  fs.writeFileSync(path.join(apiDir, 'index.html'), apiIndexHtml);
}

// 3. Generate root index.html
const rootIndexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Task APIs WPT Runner</title>
    <style>
        body { font-family: sans-serif; line-height: 1.6; max-width: 800px; margin: 2rem auto; padding: 0 1rem; }
        h1 { border-bottom: 2px solid #eee; padding-bottom: 0.5rem; }
        ul { padding-left: 1.5rem; }
        li { margin-bottom: 1rem; }
        a { color: #0066cc; text-decoration: none; font-size: 1.1rem; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>Task APIs WPT Tests</h1>
    <p>Select an API to run tests for:</p>
    <ul>
        ${apis
          .filter((api) => fs.existsSync(path.join(WPT_DIR, api)))
          .map(
            (api) => `
            <li>
                <a href="${api}/index.html"><strong>${api.toUpperCase()}</strong></a>
                (${apiTests[api].length} tests × ${activeBackends.length} backends)
            </li>
        `
          )
          .join('')}
    </ul>
</body>
</html>`;

fs.writeFileSync(path.join(WPT_DIR, 'index.html'), rootIndexHtml);

console.log('Done.');
