// scripts/copy-polyfills.js
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const libDir = path.join(__dirname, '..', 'lib');

function bundleFile(src, dest) {
  const srcPath = path.join(__dirname, '..', src);
  const destPath = path.join(__dirname, '..', dest);

  if (fs.existsSync(srcPath)) {
    const destDir = path.dirname(destPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    console.log(`Bundling ${src} -> ${dest}...`);
    // Added --main-fields to prefer ESM and ensure better resolution
    // Added --platform=browser explicitly
    execSync(
      `npx esbuild "${srcPath}" --bundle --format=esm --outfile="${destPath}" --platform=browser --main-fields=module,main`,
      { stdio: 'inherit' }
    );
  } else {
    console.warn(`Warning: ${src} not found.`);
  }
}

console.log(
  'Automating polyfill bundling and resolving all bare specifiers...'
);

// Clean and recreate lib directory
if (fs.existsSync(libDir)) {
  fs.rmSync(libDir, { recursive: true, force: true });
}
fs.mkdirSync(libDir, { recursive: true });

// --- REFINED BUNDLING STRATEGY ---
// We use ESBuild's ability to name entry points (name=path) to keep the 
// structure clean while still splitting shared code into chunks.

const promptBackendsDir = path.join(__dirname, '..', 'node_modules/prompt-api-polyfill/dist/backends');
const taskApisDir = path.join(__dirname, '..', 'node_modules/built-in-ai-task-apis-polyfills/dist');

// Define entries with explicit output paths relative to outdir (lib/)
const entries = [];

// 1. Prompt API Main
entries.push(`prompt-api-polyfill/prompt-api-polyfill=node_modules/prompt-api-polyfill/dist/prompt-api-polyfill.js`);

// 2. Prompt Backends
if (fs.existsSync(promptBackendsDir)) {
  fs.readdirSync(promptBackendsDir)
    .filter((file) => file.endsWith('.js'))
    .forEach((file) => {
      const name = file.replace('.js', '');
      entries.push(`prompt-api-polyfill/backends/${name}=node_modules/prompt-api-polyfill/dist/backends/${file}`);
    });
}

// 3. Task APIs
if (fs.existsSync(taskApisDir)) {
  fs.readdirSync(taskApisDir)
    .filter((file) => file.endsWith('.js'))
    .forEach((file) => {
      const name = file.replace('.js', '');
      entries.push(`task-apis-polyfills/${name}=node_modules/built-in-ai-task-apis-polyfills/dist/${file}`);
    });
}

console.log('Bundling all polyfills with optimized code-splitting and structure preservation...');
const outDir = path.join(__dirname, '..', 'lib');

execSync(
  `npx esbuild ${entries.map(e => `"${e}"`).join(' ')} --bundle --format=esm --splitting --platform=browser --main-fields=module,main --outdir="${outDir}" --chunk-names=chunks/[name]-[hash]`,
  { stdio: 'inherit' }
);

// 4. Transformers.js binary assets (WASM/JSEP)
// These need to be accessible locally to bypass extension CSP.
const transformersAssetsDir = path.join(
  __dirname,
  '..',
  'lib/prompt-api-polyfill/backends/transformers-assets'
);
if (!fs.existsSync(transformersAssetsDir)) {
  fs.mkdirSync(transformersAssetsDir, { recursive: true });
}
const transformersDistDir = path.join(__dirname, '..', 'node_modules/@huggingface/transformers/dist');
if (fs.existsSync(transformersDistDir)) {
  fs.readdirSync(transformersDistDir)
    .filter((file) => file.startsWith('ort-wasm-simd-threaded.jsep.'))
    .forEach((file) => {
      console.log(`Copying ${file} to ${transformersAssetsDir}...`);
      fs.copyFileSync(
        path.join(transformersDistDir, file),
        path.join(transformersAssetsDir, file)
      );
    });
}

console.log('✅ All polyfills bundled with optimized code-splitting.');
