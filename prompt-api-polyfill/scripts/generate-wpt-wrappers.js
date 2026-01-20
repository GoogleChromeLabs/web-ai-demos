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

console.log('Generating unified WPT runner...');
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
      // Cleanup old wrapper if it exists
      const htmlPath = fullPath.replace('.js', '.html');
      if (fs.existsSync(htmlPath)) {
        fs.unlinkSync(htmlPath);
        console.log(`Deleted old wrapper: ${htmlPath}`);
      }
    }
  }
}

collectTests(path.join(WPT_DIR, 'language-model'));

const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Prompt API WPT Runner</title>
    <style>
        body { font-family: sans-serif; line-height: 1.6; max-width: 800px; margin: 2rem auto; padding: 0 1rem; }
        h1 { border-bottom: 2px solid #eee; padding-bottom: 0.5rem; }
        #log { margin-top: 2rem; border: 1px solid #eee; padding: 1rem; border-radius: 4px; }
    </style>
    ${injectedConfigs}
    <script src="resources/testharness.js"></script>
    <script src="resources/testharnessreport.js"></script>
    <script src="resources/testdriver.js"></script>
    <script src="resources/testdriver-vendor.js"></script>
    <script src="resources/util.js"></script>
    <script type="module" src="../../async-iterator-polyfill.js"></script>
    <script type="module" src="../../prompt-api-polyfill.js"></script>
</head>
<body>
    <h1>Prompt API WPT Tests</h1>
    <p>Running all tests against the polyfill in a single page.</p>
    <div id="log"></div>
    ${testFiles.map(file => `<script type="module" src="${file}"></script>`).join('\n    ')}
</body>
</html>`;

fs.writeFileSync(path.join(WPT_DIR, 'index.html'), indexHtml);
console.log(`Generated unified runner: ${path.join(WPT_DIR, 'index.html')}`);
console.log('Done.');

