/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Builds the extension and publishes it to the Chrome Web Store (API v2). No
// dependencies: the API is plain HTTPS + JSON, and the JWT it needs is signed
// with node:crypto.

import { execFileSync } from 'node:child_process';
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE = `Usage:
  node publish-extension.mjs [options]

Options:
  --status       Print what the store currently has (version, review state)
                 and exit. Needs credentials, so it doubles as a check that
                 they work.
  --dry-run      Authenticate, build the archive, and check its version, but
                 upload and submit nothing.
  --staged       Once approved, hold the release instead of publishing it
                 right away (publish it later from the Developer Dashboard).
  --allow-dirty  Publish even if the extension has uncommitted changes. The
                 archive is built from the working tree, so by default that
                 is refused.
  -h, --help     Show this help and exit.

Credentials are read from the environment or the gitignored .env file next
to this script. See .env.example for the variables.`;

const EXTENSION_ROOT = dirname(fileURLToPath(import.meta.url));

// Not secret (both are visible in the Developer Dashboard), so they default
// to this extension's values. Override with CWS_PUBLISHER_ID / CWS_ITEM_ID.
const CHROME_PUBLISHER_ID = '6452897e-23a2-4474-82bf-cbe87fcfc7f7';
const CHROME_ITEM_ID = 'aekdeffgkjegkdbdnkllpaeakcapfjdb';
const CWS_SCOPE = 'https://www.googleapis.com/auth/chromewebstore';
const CWS_API = 'https://chromewebstore.googleapis.com';

const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 10 * 60_000;

class UsageError extends Error {}

function parseArgs(argv) {
  const options = {
    status: false,
    dryRun: false,
    staged: false,
    allowDirty: false,
    help: false,
  };
  for (const arg of argv) {
    switch (arg) {
      case '--status':
        options.status = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--staged':
        options.staged = true;
        break;
      case '--allow-dirty':
        options.allowDirty = true;
        break;
      case '-h':
      case '--help':
        options.help = true;
        break;
      default:
        throw new UsageError(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function loadEnv() {
  try {
    process.loadEnvFile(join(EXTENSION_ROOT, '.env'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Compares dotted numeric versions ("1.10.4" vs "1.9.0"), the only format the
// store accepts for this extension.
function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) {
      return Math.sign(diff);
    }
  }
  return 0;
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

async function readJsonResponse(response, what) {
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!response.ok) {
    const detail = body.error?.message || body.raw || JSON.stringify(body);
    const error = new Error(
      `${what} failed with HTTP ${response.status}: ${detail}`
    );
    error.status = response.status;
    throw error;
  }
  return body;
}

// ── Build ───────────────────────────────────────────────────────────────────

// Only the extension's own directory counts. The rest of the monorepo doesn't
// end up in the archive.
function assertCleanTree() {
  const status = execFileSync('git', ['status', '--porcelain', '--', '.'], {
    cwd: EXTENSION_ROOT,
    encoding: 'utf8',
    // Only trim the end: porcelain lines start with a meaningful space.
  }).trimEnd();
  if (!status) {
    return;
  }
  throw new UsageError(
    `The extension has uncommitted changes, and the archive would be built from them:\n` +
      status
        .split('\n')
        .map((line) => `  ${line}`)
        .join('\n') +
      `\nCommit them first, or pass --allow-dirty to publish anyway.`
  );
}

function readVersion(path) {
  return JSON.parse(readFileSync(join(EXTENSION_ROOT, path), 'utf8')).version;
}

// The store reads the version from the manifest, and `package.json` carries
// the same number, so a mismatch means one of them was forgotten.
function assertVersionsMatch() {
  const manifestVersion = readVersion('public/manifest.json');
  const packageVersion = readVersion('package.json');
  if (manifestVersion !== packageVersion) {
    throw new UsageError(
      `public/manifest.json says ${manifestVersion}, but package.json says ` +
        `${packageVersion}. Bump both to the same version.`
    );
  }
  return manifestVersion;
}

function build() {
  console.log('==> Building the archive');
  execFileSync('bash', [join(EXTENSION_ROOT, 'zip-extension.sh')], {
    cwd: EXTENSION_ROOT,
    stdio: 'inherit',
  });
  const zipPath = join(EXTENSION_ROOT, 'built-in-ai-extension.zip');
  return {
    version: readVersion('dist/manifest.json'),
    bytes: readFileSync(zipPath),
  };
}

// ── Chrome Web Store ────────────────────────────────────────────────────────

async function chromeAccessToken() {
  const impersonate = process.env.CWS_SERVICE_ACCOUNT;
  const keyPath = process.env.CWS_SERVICE_ACCOUNT_KEY_PATH;
  const keyJson = process.env.CWS_SERVICE_ACCOUNT_KEY;

  if (impersonate) {
    // Google's recommended route: short-lived tokens minted through gcloud,
    // with no key file on disk. Needs `gcloud auth login` and the
    // Service Account Token Creator role on the service account.
    try {
      return execFileSync(
        'gcloud',
        [
          'auth',
          'print-access-token',
          `--impersonate-service-account=${impersonate}`,
          `--scopes=${CWS_SCOPE}`,
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      ).trim();
    } catch (error) {
      const stderr = error.stderr?.toString().trim() || error.message;
      throw new Error(
        `gcloud could not mint a token impersonating ${impersonate}:\n${stderr}\n` +
          'Run `gcloud auth login` with an account that has the ' +
          'Service Account Token Creator role on it.',
        { cause: error }
      );
    }
  }

  if (!keyPath && !keyJson) {
    throw new UsageError(
      'No Chrome Web Store credentials. Set CWS_SERVICE_ACCOUNT (to ' +
        'impersonate the service account through gcloud), or ' +
        'CWS_SERVICE_ACCOUNT_KEY_PATH / CWS_SERVICE_ACCOUNT_KEY (a JSON key). ' +
        'See .env.example.'
    );
  }
  const key = JSON.parse(keyPath ? readFileSync(keyPath, 'utf8') : keyJson);
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(
    JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: key.private_key_id })
  );
  const claims = base64url(
    JSON.stringify({
      iss: key.client_email,
      scope: CWS_SCOPE,
      aud: key.token_uri,
      iat: now,
      exp: now + 3600,
    })
  );
  const signature = createSign('RSA-SHA256')
    .update(`${header}.${claims}`)
    .sign(key.private_key, 'base64url');
  const response = await fetch(key.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${signature}`,
    }),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(
      'Exchanging the service account key for a token failed: ' +
        (body.error_description || body.error)
    );
  }
  return body.access_token;
}

function chromeItemName() {
  const publisherId = process.env.CWS_PUBLISHER_ID || CHROME_PUBLISHER_ID;
  const itemId = process.env.CWS_ITEM_ID || CHROME_ITEM_ID;
  return `publishers/${publisherId}/items/${itemId}`;
}

async function chromeRequest(token, method, url, what, init = {}) {
  const response = await fetch(url, {
    ...init,
    method,
    headers: { Authorization: `Bearer ${token}`, ...init.headers },
  });
  try {
    return await readJsonResponse(response, what);
  } catch (error) {
    if (error.status === 403 || error.status === 401) {
      error.message +=
        '\nCheck that the service account email is added in the Developer ' +
        'Dashboard (Account section), that the publisher ID is right, and ' +
        'that the Chrome Web Store API is enabled in its Cloud project.';
    }
    throw error;
  }
}

function describeChromeStatus(status) {
  const lines = [];
  for (const [label, revision] of [
    ['Published', status.publishedItemRevisionStatus],
    ['Submitted', status.submittedItemRevisionStatus],
  ]) {
    if (!revision) {
      continue;
    }
    const channels = (revision.distributionChannels || [])
      .map((c) => `${c.crxVersion} at ${c.deployPercentage ?? 100}%`)
      .join(', ');
    lines.push(
      `  ${label}: ${revision.state}${channels ? ` (${channels})` : ''}`
    );
  }
  if (status.lastAsyncUploadState) {
    lines.push(`  Last upload: ${status.lastAsyncUploadState}`);
  }
  if (status.takenDown) {
    lines.push('  Taken down: yes');
  }
  if (status.warned) {
    lines.push('  Warned: yes');
  }
  return lines.join('\n') || '  (nothing published or submitted yet)';
}

function newestChromeVersion(status) {
  const versions = [
    status.publishedItemRevisionStatus,
    status.submittedItemRevisionStatus,
  ]
    .flatMap((revision) => revision?.distributionChannels || [])
    .map((channel) => channel.crxVersion)
    .filter(Boolean);
  return versions.sort(compareVersions).at(-1) ?? null;
}

async function publishChrome(options) {
  const name = chromeItemName();
  console.log('==> Authenticating with the Chrome Web Store');
  const token = await chromeAccessToken();
  const fetchStatus = () =>
    chromeRequest(
      token,
      'GET',
      `${CWS_API}/v2/${name}:fetchStatus`,
      'Fetching the item status'
    );

  const status = await fetchStatus();
  console.log(
    `Chrome Web Store item ${status.itemId}:\n${describeChromeStatus(status)}`
  );
  if (options.status) {
    return;
  }

  // Checked before building, so a forgotten bump fails fast.
  const sourceVersion = assertVersionsMatch();
  const storeVersion = newestChromeVersion(status);
  if (storeVersion && compareVersions(sourceVersion, storeVersion) <= 0) {
    throw new UsageError(
      `The extension is version ${sourceVersion}, but the store already has ` +
        `${storeVersion}. Bump the version in public/manifest.json and ` +
        'package.json first.'
    );
  }
  if (status.submittedItemRevisionStatus?.state === 'PENDING_REVIEW') {
    throw new UsageError(
      'A submission is already pending review. Cancel it in the Developer ' +
        'Dashboard (or wait for the review) before uploading a new version.'
    );
  }

  const { bytes, version } = build();
  if (version !== sourceVersion) {
    throw new Error(
      `The built manifest says ${version}, but public/manifest.json says ${sourceVersion}.`
    );
  }
  if (options.dryRun) {
    console.log(
      `Dry run: would upload version ${version} (${bytes.length} bytes) and publish it.`
    );
    return;
  }

  console.log(`==> Uploading version ${version}`);
  const upload = await chromeRequest(
    token,
    'POST',
    `${CWS_API}/upload/v2/${name}:upload`,
    'Uploading',
    {
      headers: { 'Content-Type': 'application/zip' },
      body: bytes,
    }
  );
  let uploadState = upload.uploadState;
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (uploadState === 'IN_PROGRESS') {
    if (Date.now() > deadline) {
      throw new Error(
        'Timed out waiting for the Chrome Web Store to process the upload.'
      );
    }
    await sleep(POLL_INTERVAL_MS);
    uploadState = (await fetchStatus()).lastAsyncUploadState;
  }
  if (uploadState !== 'SUCCEEDED') {
    throw new Error(
      `The upload did not succeed (state: ${uploadState}). Response: ${JSON.stringify(upload)}`
    );
  }

  console.log(
    `==> Submitting for review (${options.staged ? 'staged' : 'publish on approval'})`
  );
  const result = await chromeRequest(
    token,
    'POST',
    `${CWS_API}/v2/${name}:publish`,
    'Publishing',
    {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publishType: options.staged ? 'STAGED_PUBLISH' : 'DEFAULT_PUBLISH',
      }),
    }
  );
  for (const warning of result.warningInfo?.warnings ||
    [result.warningInfo].filter(Boolean)) {
    console.warn(
      `Warning: ${warning.reason || ''} ${warning.description || JSON.stringify(warning)}`
    );
  }
  console.log(
    `✅ Chrome Web Store: version ${version} submitted, state ${result.state}.`
  );
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }
  loadEnv();
  if (!options.status && !options.dryRun && !options.allowDirty) {
    assertCleanTree();
  }
  await publishChrome(options);
}

main().catch((error) => {
  console.error(`error: ${error.message}`);
  if (error instanceof UsageError) {
    console.error('Run with --help for usage.');
  }
  process.exit(1);
});
