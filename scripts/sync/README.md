# Publishing the demos to chrome.dev

`sync-web-ai-demos.sh` publishes the demos in this repository to the Google
Cloud Storage bucket behind <https://chrome.dev/web-ai-demos/>. It clones the
repository into a scratch workspace, works out what each root-level folder is,
builds the ones that need building, and uploads the result to
`gs://chrome-dev-demos/public/web-ai-demos/<demo>/`.

The script is checked in so that the deployment is reviewable and anyone can
reproduce it. Today it runs every 30 minutes on a maintainer's machine.

## What you need

- `git`, `node`, `npm`
- `gcloud`, authenticated as someone with write access to the bucket
  (`gcloud auth login`)

## Try it

```sh
# Print the plan: classify every folder, install nothing, upload nothing.
./scripts/sync/sync-web-ai-demos.sh --list

# Build everything and show what would be uploaded, without uploading.
./scripts/sync/sync-web-ai-demos.sh --dry-run

# Publish.
./scripts/sync/sync-web-ai-demos.sh --live
```

`--dry-run` is the default, so an accidental run never touches the bucket.
`--only NAME` restricts a run to one folder and is repeatable, `--no-build`
skips demos that need building, and `--no-pull` reuses the workspace as it is.
`--help` lists everything.

A run exits non-zero if any demo failed, which is what makes it usable from
cron or a systemd timer.

## How a folder is classified

Each root-level folder ends up as one of three verdicts, printed by `--list`:

| Verdict  | Meaning                                                                    |
| -------- | -------------------------------------------------------------------------- |
| `static` | Plain HTML/CSS/JS with an `index.html` at the folder root. Uploaded as-is.  |
| `build`  | Has a build script and a recognized static-site bundler. Built, then the build output is uploaded. |
| `skip`   | Not a publishable static site: a server app, a library, a Chrome extension, a CLI tool, or a folder with no entry point. |

A few demos are published under a name that differs from their folder name, so
that URLs already in the wild keep working. Those live in the `PUBLISH_AS` map
at the top of the script. Builds are told the public base path, so absolute
asset URLs resolve under `/web-ai-demos/<demo>/` rather than at the domain
root.

If your new demo is skipped and you think it shouldn't be, run `--list` and
read the reason. Usually the fix is an `index.html` at the folder root.

## The workspace

The script keeps its own checkout and resets it to the remote on every run, so
that local leftovers (rewritten lockfiles, build output) can never block a
sync. **Never point it at a checkout you work in**: your changes would be
discarded. The default is `~/.cache/web-ai-demos-sync`, overridable with
`WEB_AI_DEMOS_WORKSPACE`.

Untracked files the remote does not carry, such as `node_modules`, are left
alone, so repeated runs don't rebuild from scratch.

## Secrets

Some demos need an API key to work at runtime. Keys are never committed, so the
script keeps them outside the checkout and copies them over it after each
reset. The directory mirrors the repository layout:

```
secrets/
├── firebase-ai-logic/.env
├── prompt-api-polyfill/.env.json
└── weather-ai/src/env.js
```

`secrets.example/` in this directory shows what each file looks like, with
placeholder values. To use it:

```sh
cp -r scripts/sync/secrets.example ~/.config/web-ai-demos-sync/secrets
# then fill in the real values
```

That path is the default, overridable with `WEB_AI_DEMOS_SECRETS`. Without it
the script still runs and still publishes; the demos that need a key build
fine, but won't work in the browser.

Two things keep the keys out of the bucket and out of git. Uploads go through a
staging copy with `.env` files, `node_modules`, and `.git` stripped, rather
than through an `rsync --exclude`, which would also hide an already-uploaded
secret from the deletion pass and leave it served forever. And the overlay
lives outside the checkout, so `git add` in the workspace cannot reach it.

Note that `weather-ai/src/env.js` is a tracked file whose committed value is a
placeholder. The overlay overwrites it locally on every run, so don't commit
that file from a workspace where the overlay has been applied.
