import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');
const WPT_BASE_DIR = path.join(ROOT_DIR, 'tests', 'wpt');
const SOURCES = [
  {
    api: 'https://api.github.com/repos/web-platform-tests/wpt/contents/ai/resources',
    local: path.join(WPT_BASE_DIR, 'resources'),
  },
  {
    api: 'https://api.github.com/repos/web-platform-tests/wpt/contents/ai/language-model',
    local: path.join(WPT_BASE_DIR, 'language-model'),
  },
  {
    download_url:
      'https://raw.githubusercontent.com/web-platform-tests/wpt/master/resources/testharness.js',
    local: path.join(WPT_BASE_DIR, 'resources', 'testharness.js'),
  },
  {
    download_url:
      'https://raw.githubusercontent.com/web-platform-tests/wpt/master/resources/testharnessreport.js',
    local: path.join(WPT_BASE_DIR, 'resources', 'testharnessreport.js'),
  },
  {
    download_url:
      'https://raw.githubusercontent.com/web-platform-tests/wpt/master/resources/testdriver.js',
    local: path.join(WPT_BASE_DIR, 'resources', 'testdriver.js'),
  },
  {
    download_url:
      'https://raw.githubusercontent.com/web-platform-tests/wpt/master/resources/testdriver-vendor.js',
    local: path.join(WPT_BASE_DIR, 'resources', 'testdriver-vendor.js'),
  },
  {
    download_url:
      'https://raw.githubusercontent.com/web-platform-tests/wpt/master/images/computer.jpg',
    local: path.join(ROOT_DIR, 'images', 'computer.jpg'),
  },
  {
    download_url:
      'https://raw.githubusercontent.com/web-platform-tests/wpt/master/media/speech.wav',
    local: path.join(ROOT_DIR, 'media', 'speech.wav'),
  },
];

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Node.js WPT Sync Script',
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
  }
  return response.json();
}

async function downloadFile(url, destPath) {
  console.log(`Downloading ${url} to ${destPath}...`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.statusText}`);
  }
  const content = await response.arrayBuffer();
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, Buffer.from(content));
}

async function syncDir(apiPath, localPath) {
  const contents = await fetchJson(apiPath);
  const files = [];

  for (const item of contents) {
    if (item.type === 'file') {
      const destFile = path.join(localPath, item.name);
      await downloadFile(item.download_url, destFile);
      files.push(path.relative(WPT_BASE_DIR, destFile));
    } else if (item.type === 'dir') {
      const subFiles = await syncDir(item.url, path.join(localPath, item.name));
      files.push(...subFiles);
    }
  }
  return files;
}

async function main() {
  console.log('Starting WPT synchronization...');

  if (fs.existsSync(WPT_BASE_DIR)) {
    const existing = fs.readdirSync(WPT_BASE_DIR);
    for (const file of existing) {
      if (file === 'index.html') {
        continue;
      }
      fs.rmSync(path.join(WPT_BASE_DIR, file), {
        recursive: true,
        force: true,
      });
    }
  } else {
    fs.mkdirSync(WPT_BASE_DIR, { recursive: true });
  }

  try {
    let allFiles = [];
    for (const source of SOURCES) {
      if (source.api) {
        const files = await syncDir(source.api, source.local);
        allFiles.push(...files);
      } else if (source.download_url) {
        await downloadFile(source.download_url, source.local);
        allFiles.push(path.relative(WPT_BASE_DIR, source.local));
      }
    }

    // Filter for test files we want to load in index.html
    const testFiles = allFiles.filter(
      (f) => f.endsWith('.js') && !f.includes('resources/')
    );

    fs.writeFileSync(
      path.join(WPT_BASE_DIR, 'tests.json'),
      JSON.stringify(testFiles, null, 2)
    );

    console.log('Successfully synchronized WPT tests.');
    console.log(`Total files: ${allFiles.length}`);
    console.log(`Test files (JS): ${testFiles.length}`);
  } catch (error) {
    console.error('Error during synchronization:', error);
    process.exit(1);
  }
}

main();
