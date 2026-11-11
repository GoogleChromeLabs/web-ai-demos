#!/usr/bin/env node
/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PACKAGE_NAME = 'built-in-ai-skills-md-agent-md';
const SKILL_NAME = 'built-in-ai';
const SKILL_TEMPLATE = path.join(__dirname, '../templates/SKILL.md');
const AGENTS_TEMPLATE = path.join(__dirname, '../templates/AGENTS.md');

// The managed block in a project's `AGENTS.md`. Version 1 of this package used
// the same marker to open and close the block, so the format stays compatible.
const AGENTS_MARKER = '<!-- BUILT-IN-AI-AGENT -->';
const LEGACY_SKILL_MARKER = '<!-- BUILT-IN-AI-SKILLS -->';

// `.agents/skills/` is the shared project location that Codex, Gemini CLI,
// GitHub Copilot, Cursor, OpenCode, and most other agents read. Claude Code
// reads `.claude/skills/` only.
const SHARED_SKILLS_DIR = path.join('.agents', 'skills');
const CLAUDE_DIR = '.claude';

const UPDATE_FLAG = '--update-agents-md';

const managedBlock = (content) =>
  `${AGENTS_MARKER}\n${content.trim()}\n${AGENTS_MARKER}\n`;

/**
 * Finds the managed block, from the first `AGENTS_MARKER` through the second.
 * @param {string} text - The `AGENTS.md` content.
 * @returns {{start: number, end: number} | null} The block's range.
 */
function findManagedBlock(text) {
  const start = text.indexOf(AGENTS_MARKER);
  if (start === -1) {
    return null;
  }
  const close = text.indexOf(AGENTS_MARKER, start + AGENTS_MARKER.length);
  if (close === -1) {
    return null;
  }
  let end = close + AGENTS_MARKER.length;
  if (text[end] === '\n') {
    end++;
  }
  return { start, end };
}

/**
 * Copies the templates verbatim into the package's own root, where
 * `npx skills add` discovers them.
 * @param {string} targetDir - The directory to sync to.
 * @param {boolean} overwrite - Whether to overwrite existing files. Without it,
 *   existing files are left untouched.
 */
export function syncTemplates(targetDir, overwrite = false) {
  for (const [name, source] of [
    ['SKILL.md', SKILL_TEMPLATE],
    ['AGENTS.md', AGENTS_TEMPLATE],
  ]) {
    const targetPath = path.join(targetDir, name);
    if (fs.existsSync(targetPath) && !overwrite) {
      console.log(`${name} already exists. Skipping.`);
      continue;
    }
    fs.copyFileSync(source, targetPath);
    console.log(`Wrote ${name}.`);
  }
}

/**
 * Installs the skill into the folders this package owns. These folders belong
 * to the package, so they are overwritten on every install to stay current.
 * @param {string} projectRoot - The project to install into.
 */
function installSkill(projectRoot) {
  const skillDirs = [path.join(projectRoot, SHARED_SKILLS_DIR, SKILL_NAME)];
  // Only add a Claude Code copy to projects that already use Claude Code.
  if (fs.existsSync(path.join(projectRoot, CLAUDE_DIR))) {
    skillDirs.push(path.join(projectRoot, CLAUDE_DIR, 'skills', SKILL_NAME));
  }
  for (const dir of skillDirs) {
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(SKILL_TEMPLATE, path.join(dir, 'SKILL.md'));
    console.log(`Installed the skill to ${path.relative(projectRoot, dir)}/.`);
  }

  // Version 1 of this package wrote `SKILL.md` to the project root, where
  // agents do not look for skills. Leave it alone and point it out.
  const legacySkill = path.join(projectRoot, 'SKILL.md');
  if (
    fs.existsSync(legacySkill) &&
    fs.readFileSync(legacySkill, 'utf8').includes(LEGACY_SKILL_MARKER)
  ) {
    console.log(
      `SKILL.md in the project root holds the Built-in AI skill from an ` +
        `earlier version of ${PACKAGE_NAME}. The skill now lives in ` +
        `${SHARED_SKILLS_DIR}/${SKILL_NAME}/, so you can remove that section ` +
        `or the whole file.`
    );
  }
}

/**
 * Creates `AGENTS.md` if the project has none. An existing file is only
 * changed when `update` is set, which the user opts into with `UPDATE_FLAG`.
 * @param {string} projectRoot - The project to install into.
 * @param {boolean} update - Whether to add or refresh the managed block in an
 *   existing `AGENTS.md`.
 */
function installAgentsMd(projectRoot, update) {
  const target = path.join(projectRoot, 'AGENTS.md');
  const block = managedBlock(fs.readFileSync(AGENTS_TEMPLATE, 'utf8'));

  if (!fs.existsSync(target)) {
    fs.writeFileSync(target, block);
    console.log('Created AGENTS.md.');
    return;
  }

  const existing = fs.readFileSync(target, 'utf8');
  const range = findManagedBlock(existing);
  const current = range && existing.slice(range.start, range.end) === block;

  if (current) {
    console.log('AGENTS.md is up to date.');
    return;
  }

  if (!update) {
    console.log(
      range
        ? `AGENTS.md has an outdated Built-in AI section. To refresh it, ` +
            `run: npx ${PACKAGE_NAME} ${UPDATE_FLAG}`
        : `AGENTS.md already exists, so it was left untouched. To add the ` +
            `Built-in AI instructions as a section you can refresh later, ` +
            `run: npx ${PACKAGE_NAME} ${UPDATE_FLAG}`
    );
    return;
  }

  const updated = range
    ? existing.slice(0, range.start) + block + existing.slice(range.end)
    : `${existing.trimEnd()}\n\n${block}`;
  fs.writeFileSync(target, updated);
  console.log(
    `${range ? 'Refreshed' : 'Added'} the Built-in AI section in AGENTS.md.`
  );
}

/**
 * Installs the skill and `AGENTS.md` into a project.
 * @param {string} projectRoot - The project to install into.
 * @param {{updateAgentsMd?: boolean}} options - Install options.
 */
export function install(projectRoot, { updateAgentsMd = false } = {}) {
  console.log(`Installing Built-in AI agent instructions to ${projectRoot}...`);
  installSkill(projectRoot);
  installAgentsMd(projectRoot, updateAgentsMd);
}

const isMain =
  process.argv[1] && fs.realpathSync(process.argv[1]) === __filename;

if (isMain) {
  // `INIT_CWD` is where the user ran `npm install` or `npx`.
  const projectRoot = process.env.INIT_CWD || process.cwd();
  const packageRoot = path.join(__dirname, '..');
  const isPostinstall = process.env.npm_lifecycle_event === 'postinstall';

  if (path.resolve(projectRoot) === path.resolve(packageRoot)) {
    console.log('Running inside the package root. Regenerating templates.');
    syncTemplates(packageRoot, true);
  } else if (isPostinstall && process.env.npm_config_global === 'true') {
    // A global install has no project to write into.
    console.log(
      `Skipping the global install. Run npx ${PACKAGE_NAME} in a project.`
    );
  } else {
    install(projectRoot, {
      updateAgentsMd: process.argv.slice(2).includes(UPDATE_FLAG),
    });
  }
}
