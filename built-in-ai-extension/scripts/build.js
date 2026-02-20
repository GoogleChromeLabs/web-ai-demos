// scripts/build.js
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const distDir = path.join(__dirname, '..', 'dist');

const itemsToCopy = [
  'manifest.json',
  'src',
  'options',
  'icons',
  'offscreen',
  'lib',
];

function copyRecursiveSync(src, dest) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();
  if (isDirectory) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    fs.readdirSync(src).forEach((childItemName) => {
      copyRecursiveSync(
        path.join(src, childItemName),
        path.join(dest, childItemName)
      );
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}

console.log('Building extension to dist/ folder...');

// 1. Ensure polyfills and vendors are prepared
console.log('Running prepare script...');
execSync('npm run prepare', { stdio: 'inherit' });

// 2. Clean and recreate dist directory
if (fs.existsSync(distDir)) {
  console.log('Cleaning old dist/ directory...');
  fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir, { recursive: true });

// 3. Copy files to dist
itemsToCopy.forEach((item) => {
  const srcPath = path.join(__dirname, '..', item);
  const destPath = path.join(distDir, item);

  if (fs.existsSync(srcPath)) {
    console.log(`Copying ${item} to dist/...`);
    copyRecursiveSync(srcPath, destPath);
  } else {
    console.warn(`Warning: ${item} not found.`);
  }
});

console.log(
  '✅ Build complete! You can now load the "dist" folder as an unpacked extension in Chrome.'
);
