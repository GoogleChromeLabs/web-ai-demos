# built-in-ai-skills-md-agent-md

An npm package that automatically teaches your AI agent about the latest
Built-in AI APIs and their polyfills.

## What it does

This package installs a Built-in AI skill and agent instructions into your
project. Together they:

- Inform the AI about the deprecation of `window.ai.*` in favor of top-level
  APIs (e.g., `window.LanguageModel`).
- Provide the latest Web IDLs for Translation, Writing Assistance, and Prompt
  APIs.
- Make the AI aware of critical polyfills.
- Set a persona for the AI as a "Built-in AI Expert".

### Files it writes

- `.agents/skills/built-in-ai/SKILL.md`: the skill, in the shared project
  location that Codex, Gemini CLI, GitHub Copilot, Cursor, OpenCode, and most
  other agents read.
- `.claude/skills/built-in-ai/SKILL.md`: the same skill for Claude Code, written
  only if your project already has a `.claude/` folder.
- `AGENTS.md`: created only if your project has none.

The package owns the skill folders and overwrites them on every install, so the
IDLs stay current. Your own `AGENTS.md` is yours: if it exists, the package
leaves it untouched and prints how to add its instructions. Adding them is an
explicit step:

```bash
npx built-in-ai-skills-md-agent-md --update-agents-md
```

This adds the instructions to `AGENTS.md` between `<!-- BUILT-IN-AI-AGENT -->`
markers. Running the same command again later refreshes that section in place
and leaves the rest of the file alone.

## Usage

### With npm

Install the package:

```bash
npm install built-in-ai-skills-md-agent-md
```

The `postinstall` script writes the files listed above. Recent npm versions ask
you to approve install scripts with `npm approve-scripts`, and pnpm, Bun, and
Yarn Berry skip them by default. If the script did not run, run the installer
yourself in your project root:

```bash
npx built-in-ai-skills-md-agent-md
```

### Upgrading from version 1

Version 1 wrote `SKILL.md` to the project root, where agents do not look for
skills, and appended to existing `SKILL.md` and `AGENTS.md` files. Version 2
never modifies those files on install. If your root `SKILL.md` still contains
the Built-in AI section, the installer says so, and you can remove that section
or the whole file. To refresh an `AGENTS.md` section that version 1 added, run
the `--update-agents-md` command above.

### With the `skills` command

Run the [`skills` command](https://skills.sh/) and follow the wizard:

```bash
npx skills add GoogleChromeLabs/web-ai-demos
```

## Updating IDLs

To fetch the latest IDLs from the official webmachinelearning specifications,
run:

```bash
npm run update-idls
```
