// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Google LLC

// Tools the model can call, split into two halves:
//
//   1. The implementations below, which do the actual work.
//   2. The declarations exported at the bottom, which describe each tool to
//      the model: its `name`, `description`, and `inputSchema`.
//
// Only the declarations reach the model. `execute()` stays on this side, so
// the split mirrors what actually crosses that boundary.
//
// Both APIs are called unauthenticated, so no API key is needed. GitHub's
// limit is then 60 requests per hour and per IP address.

const GITHUB_API = 'https://api.github.com';
const NPM_REGISTRY = 'https://registry.npmjs.org';

// How many packages one search returns at most, and how many repositories one
// `get_repo_stars` call looks up. Every repository is a separate GitHub
// request against that hourly quota of 60.
const MAX_REPOS = 10;

// ─── Implementations ─────────────────────────────────────────────────────────

// Every implementation returns its result as a JSON string, and reports
// failures as a returned `{ error, message }` rather than by throwing, so the
// model can tell the user what went wrong instead of the turn dying.

// One repository, as its own object. Failures come back as an `{ error,
// message }` entry rather than sinking the whole batch: one repository that has
// been renamed should not cost the model the other nine star counts.
async function fetchRepoStars({ owner, repo }) {
  const path =
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  let response;
  try {
    response = await fetch(`${GITHUB_API}${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  } catch {
    return {
      owner,
      repo,
      error: 'request_failed',
      message: 'The GitHub API could not be reached.',
    };
  }

  if (!response.ok) {
    if (response.status === 404) {
      return {
        owner,
        repo,
        error: 'not_found',
        message: `There is no repository at ${owner}/${repo}.`,
      };
    }
    if (response.status === 403 || response.status === 429) {
      return {
        owner,
        repo,
        error: 'rate_limited',
        message: 'The GitHub API rate limit is exhausted. Try again later.',
      };
    }
    return {
      owner,
      repo,
      error: 'request_failed',
      message: `The GitHub API responded with ${response.status}.`,
    };
  }

  // Only the fields the model needs. Everything returned here ends up in the
  // session's context window, so keep the payload small.
  const data = await response.json();
  return {
    repository: data.full_name,
    stars: data.stargazers_count,
    forks: data.forks_count,
    description: data.description,
    url: data.html_url,
  };
}

// Takes a whole list of repositories, because comparing packages is the point:
// one repository per tool call means a round trip through the model for each,
// and a small model tends to lose the thread and answer from the first star
// count it saw. One call, one comparison.
//
// GitHub has no batch endpoint, so this still makes one request per repository,
// just in parallel. The saving is in model round trips, not in HTTP requests:
// the unauthenticated rate limit of 60 requests per hour still counts every
// repository separately.
async function getRepoStars({ repositories, owner, repo }) {
  // A single `{ owner, repo }` pair is accepted as well. The schema asks for an
  // array, but small models regularly send the shape the question had instead,
  // and a demo that answers "wrong arguments" there teaches nothing.
  const requested = Array.isArray(repositories)
    ? repositories
    : repositories
      ? [repositories]
      : owner || repo
        ? [{ owner, repo }]
        : [];

  const wanted = requested.filter((entry) => entry?.owner && entry?.repo);
  if (wanted.length === 0) {
    return JSON.stringify({
      error: 'invalid_arguments',
      message:
        'Call get_repo_stars with a "repositories" array whose entries each ' +
        'have an "owner" and a "repo", for example ' +
        '[{"owner": "GoogleChromeLabs", "repo": "web-ai-demos"}].',
    });
  }

  // Capped at what one search can return, so a search result can always be
  // looked up in a single call and a runaway list cannot burn the hourly quota.
  const results = await Promise.all(
    wanted.slice(0, MAX_REPOS).map(fetchRepoStars),
  );
  return JSON.stringify({ repositories: results });
}

async function searchNpmPackages({ query, limit = 3 }) {
  // npm normalizes repository links to a handful of shapes, all of which
  // need to collapse to a plain `owner/repo` pair so the result can be handed
  // straight to `get_repo_stars`:
  //
  //   git+https://github.com/owner/repo.git
  //   git+ssh://git@github.com/owner/repo.git
  //   https://github.com/owner/repo/tree/main/packages/sub   (monorepo package)
  //   github:owner/repo
  function parseGitHubRepo(url) {
    if (!url) {
      return null;
    }
    const shorthand = url.match(/^github:([^/]+)\/(.+)$/);
    const match = shorthand
      ? shorthand
      : url.match(/github\.com[/:]([^/]+)\/([^/#?]+)/);
    if (!match) {
      return null;
    }
    const owner = match[1];
    const repo = match[2].replace(/\.git$/, '');
    if (!owner || !repo) {
      return null;
    }
    return { owner, repo };
  }

  // Default deliberately low: every extra package is another GitHub request
  // against the hourly quota, and another entry in the context window.
  const count = Math.min(Math.max(Number(limit) || 3, 1), MAX_REPOS);
  // Over-fetch, because packages without a GitHub repository are dropped
  // below and would otherwise leave the list short.
  const size = Math.min(count * 4, 50);
  const url =
    `${NPM_REGISTRY}/-/v1/search` +
    `?text=${encodeURIComponent(query)}&size=${size}`;

  let data;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return JSON.stringify({
        error: 'request_failed',
        message: `The npm registry responded with ${response.status}.`,
      });
    }
    data = await response.json();
  } catch {
    return JSON.stringify({
      error: 'request_failed',
      message: 'The npm registry could not be reached.',
    });
  }

  const packages = [];
  for (const object of data.objects ?? []) {
    const pkg = object.package;
    const gitHub = parseGitHubRepo(pkg.links?.repository);
    // The filter the tool promises: no GitHub repository, no result.
    if (!gitHub) {
      continue;
    }
    packages.push({
      name: pkg.name,
      version: pkg.version,
      description: pkg.description,
      // Split out so the model can pass these straight to get_repo_stars.
      owner: gitHub.owner,
      repo: gitHub.repo,
      npmUrl: pkg.links?.npm,
    });
    if (packages.length === count) {
      break;
    }
  }

  // The search endpoint drops `repository.directory`, so ask the registry for
  // each candidate. A directory means the package sits in a subdirectory of a
  // larger repository, and that repository's stars are not the package's
  // stars: `prompt-api-polyfill` lives in `GoogleChromeLabs/web-ai-demos`,
  // whose stars cover every demo in it. Fetched in parallel, and best effort:
  // a package that cannot be checked is simply left unflagged.
  await Promise.all(
    packages.map(async (pkg) => {
      try {
        // Scoped names keep their `@`, but the slash has to be escaped.
        const response = await fetch(
          `${NPM_REGISTRY}/${pkg.name.replace('/', '%2F')}/latest`,
        );
        if (!response.ok) {
          return;
        }
        const doc = await response.json();
        if (doc.repository?.directory) {
          pkg.sharedRepository = true;
        }
      } catch {
        // Leave the package unflagged.
      }
    }),
  );

  if (packages.length === 0) {
    return JSON.stringify({
      error: 'no_results',
      message: `No npm packages with a GitHub repository matched "${query}".`,
    });
  }
  return JSON.stringify({ query, packages });
}

// ─── Declarations ────────────────────────────────────────────────────────────

// This is everything the model is told about the tools. The wording is part of
// the prompt: it is what the model reasons over when deciding which tool to
// call and what to pass it.

export const tools = [
  {
    name: 'search_npm_packages',
    description:
      'Search the npm registry for packages matching a query, for example ' +
      '"browser fs access". Only returns packages that have an associated ' +
      'GitHub repository. Use this to find candidate packages, then look up ' +
      "their popularity with get_repo_stars. Comparing packages means passing " +
      'every package this returns to get_repo_stars in one call, not just the ' +
      'first one. A package marked ' +
      '"sharedRepository": true lives inside a repository that holds several ' +
      'packages, so that repository\'s star count covers all of them and is ' +
      'not a measure of that one package. Say so whenever you report or ' +
      'compare stars for such a package.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'What to search for, for example "browser fs access" or "date ' +
            'formatting".',
        },
        limit: {
          type: 'number',
          description:
            'How many packages to return. Defaults to 3, at most 10. Keep ' +
            'this small: every package is another GitHub lookup.',
        },
      },
      required: ['query'],
    },
    execute: searchNpmPackages,
  },
  {
    name: 'get_repo_stars',
    description:
      'Get the number of GitHub stars one or more repositories have. Use ' +
      'this whenever someone asks how popular a repository is or how many ' +
      'stars it has. Pass every repository you want to compare in a single ' +
      'call, up to 10 at a time, rather than calling this once per ' +
      'repository. Stars belong to the repository as a whole, so if the ' +
      'repository holds more than one package, the count is not a measure of ' +
      'any single one of them.',
    inputSchema: {
      type: 'object',
      properties: {
        repositories: {
          type: 'array',
          description:
            'The repositories to look up, all of them in this one call, for ' +
            'example [{"owner": "GoogleChromeLabs", "repo": "web-ai-demos"}].',
          items: {
            type: 'object',
            properties: {
              owner: {
                type: 'string',
                description:
                  'The user or organization that owns the repository, for ' +
                  'example "GoogleChromeLabs".',
              },
              repo: {
                type: 'string',
                description:
                  'The name of the repository without the owner, for ' +
                  'example "web-ai-demos".',
              },
            },
            required: ['owner', 'repo'],
          },
        },
      },
      required: ['repositories'],
    },
    execute: getRepoStars,
  },
];
