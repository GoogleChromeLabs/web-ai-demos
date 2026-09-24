#!/bin/bash
#
# Copyright 2026 Google LLC
# SPDX-License-Identifier: Apache-2.0
#
# Syncs the demos from the web-ai-demos repository to a Google Cloud Storage
# bucket, which serves them at https://chrome.dev/web-ai-demos/<demo>/.
#
# Each root-level folder is classified as one of:
#
#   static  Plain HTML/CSS/JS. Uploaded as-is.
#   build   Has a build step (Vite, Parcel, react-scripts, ...). Dependencies
#           are installed, the app is built, and only the build output is
#           uploaded.
#   skip    Not a publishable static site: a server app, a library, a Chrome
#           extension, a CLI tool, or a folder with no entry point.
#
# Run with --list first to see the plan without building or uploading anything.

set -uo pipefail

usage() {
    cat <<'USAGE'
Usage: sync-web-ai-demos.sh [options]

  --dry-run     Show what would be uploaded, upload nothing. Demos are still
                built, so this checks the build step too. (default)
  --live        Actually upload.
  --list        Only classify the folders and print the plan: no install, no
                build, no upload. Use this to check the heuristics.
  --only NAME   Restrict to one demo folder. Repeatable.
  --no-build    Sync static demos only; report buildable ones as skipped.
  --no-pull     Use the existing checkout as-is, without fetch/reset.
  -h, --help    Show this help.

Environment:
  WEB_AI_DEMOS_WORKSPACE  Where the checkout is kept, reset to the remote on
                          every run. Default ~/.cache/web-ai-demos-sync.
  WEB_AI_DEMOS_SECRETS    Secrets overlay, mirroring the repository layout.
                          Default ~/.config/web-ai-demos-sync/secrets.
                          See scripts/sync/secrets.example.
USAGE
}

# --- Configuration ---
REPO_URL="https://github.com/googleChromeLabs/web-ai-demos/"
REPO_DIR="web-ai-demos"
GCS_BUCKET="gs://chrome-dev-demos/public/web-ai-demos/"

# Public path the bucket is served from, i.e. https://chrome.dev/web-ai-demos/.
# Builds are told about it so that absolute asset URLs resolve. Needs a leading
# and a trailing slash.
PUBLIC_BASE_PATH="/web-ai-demos/"

# Default run mode. Override per-invocation with --dry-run / --live.
DRY_RUN="true"

# Where the checkout is kept. The script resets this directory to the remote on
# every run, so point it at a scratch location, never at a checkout you work
# in. Both paths below default outside any checkout, which lets this script
# live in the repository it syncs without ever pointing at itself.
WORKSPACE_DIR="${WEB_AI_DEMOS_WORKSPACE:-$HOME/.cache/web-ai-demos-sync}"

# Local secrets, kept outside the checkout so that a reset cannot clobber them
# and git cannot accidentally commit them. The directory mirrors the repository
# layout, and every file in it is copied over the checkout after each clone or
# reset, e.g.
#
#   secrets/weather-ai/src/env.js        -> weather-ai/src/env.js
#   secrets/firebase-ai-logic/.env       -> firebase-ai-logic/.env
#
# The checkout is reset to the remote before each run, so edits the overlay
# makes to tracked files are discarded and re-applied every time. See
# scripts/sync/secrets.example in the repository for the expected layout.
SECRETS_DIR="${WEB_AI_DEMOS_SECRETS:-$HOME/.config/web-ai-demos-sync/secrets}"

# Demos already published under a name that differs from their folder name.
# Keeping these in sync with the live site avoids publishing a second copy at
# the folder name and leaving the existing URL to go stale.
declare -A PUBLISH_AS=(
    ["product-review-auto-rating-io"]="product-reviews"
    ["perf-worker-gemma"]="perf-client-side-gemma-worker"
    ["perf-no-worker-gemma"]="perf-client-side-gemma-no-worker"
    ["weather-ai"]="prompt-api-weather"
)

# Demos whose build configuration already targets this deployment and should be
# left alone. Everything else is built with `--base` (Vite) or `PUBLIC_URL`
# (react-scripts) pointing at PUBLIC_BASE_PATH + the published name.
BASE_OVERRIDE_EXCEPTIONS=()

# Root-level folders that are never demos.
EXCLUDED_FOLDERS=(
    "landing-pages"
    "scripts"
    "node_modules"
)

# Packages that mean the app needs a server at runtime, so it cannot be served
# as static files from a bucket. Only runtime `dependencies` are inspected: a
# server package in `devDependencies` is usually just a local preview server.
SERVER_PACKAGES=(
    "express" "fastify" "koa" "@hapi/hapi" "@nestjs/core" "hono" "polka"
    "restify" "next" "nuxt" "@sveltejs/adapter-node" "socket.io"
)

# Packages that mean `npm run build` produces a browsable static site rather
# than a compiled server, a library bundle, or a CLI. A build script without
# one of these is not something we can publish to a bucket.
STATIC_BUNDLERS=(
    "vite" "parcel" "react-scripts" "astro" "@11ty/eleventy" "gatsby"
    "@angular/cli" "webpack" "rollup" "esbuild" "snowpack" "browserify"
    "@sveltejs/kit"
)

# Directories a build tool may write its output to, in the order we prefer
# them. Deliberately excludes `public/` and `docs/`, which are build *inputs*
# in Vite and Parcel projects.
OUTPUT_DIR_CANDIDATES=("dist-demos" "dist-demo" "dist" "build" "out" "_site")

# Never upload these, whatever folder they turn up in. They are stripped from a
# staging copy before the sync rather than passed to `gcloud storage rsync
# --exclude`, because that flag hides matching objects at BOTH ends: an
# excluded file already in the bucket would never be deleted, so a secret
# uploaded by an earlier run would survive every later sync. Each entry is a
# `find -path` glob, relative to the directory being synced.
EXCLUDE_GLOBS=(
    '*/node_modules'
    '*/.git'
    '*/.env'
    '*/.env.*'
    '*/.parcel-cache'
    '*/.vite'
    '*/.DS_Store'
)

# --- Argument parsing ---
LIST_ONLY="false"
DO_BUILD="true"
DO_PULL="true"
ONLY_FOLDERS=()

while [ $# -gt 0 ]; do
    case "$1" in
        --dry-run)  DRY_RUN="true" ;;
        --live)     DRY_RUN="false" ;;
        --list)     LIST_ONLY="true" ;;
        --no-build) DO_BUILD="false" ;;
        --no-pull)  DO_PULL="false" ;;
        --only)
            if [ -z "${2:-}" ]; then
                echo "Error: --only needs a folder name." >&2
                exit 2
            fi
            ONLY_FOLDERS+=("${2%/}")
            shift
            ;;
        -h|--help) usage; exit 0 ;;
        *)
            echo "Error: unknown option '$1'. Try --help." >&2
            exit 2
            ;;
    esac
    shift
done

if [ "$DRY_RUN" = "true" ]; then
    GCLOUD_DRY_RUN_FLAG="--dry-run"
    echo "⚠️  DRY RUN MODE ACTIVE: No files will be uploaded or deleted. ⚠️"
else
    GCLOUD_DRY_RUN_FLAG=""
    echo "🚀 LIVE RUN MODE ACTIVE: Files will be synchronized. 🚀"
fi

# -------------------------------------------------------------
# --- Helpers ---

# Progress goes to stderr, so that functions whose stdout is captured by the
# caller (build_app) can still report what they are doing.
log() { printf '%s\n' "$*" >&2; }

# Copies $1 into a staging directory under LOG_DIR with every EXCLUDE_GLOBS
# match removed, and prints the staging path. The sync then uploads a directory
# that simply does not contain anything secret, so rsync's delete pass stays
# free to remove stale objects at the destination.
stage_for_upload() {
    local source_dir="$1"
    local staged="$LOG_DIR/staged/$(slug "$source_dir")"
    local glob
    local -a prune=()

    rm -rf "$staged"
    mkdir -p "$(dirname "$staged")"
    cp -a "$source_dir" "$staged" || return 1

    for glob in "${EXCLUDE_GLOBS[@]}"; do
        prune+=(-path "$glob" -o)
    done
    unset 'prune[${#prune[@]}-1]'

    find "$staged" \( "${prune[@]}" \) -exec rm -rf {} + 2>/dev/null

    printf '%s\n' "$staged"
}

# Turns a path into something safe to use as a log file name.
slug() { printf '%s\n' "${1//\//_}"; }

# Reads package.json in the directory $1 and answers one question ($2):
#   build-script  name of the script that builds a static site, if any
#   server-dep    comma-separated runtime deps that imply a server
#   bundler       comma-separated deps that imply a static site build
# Prints nothing and returns non-zero when the answer is empty or the file is
# unreadable, so callers can branch on the exit status.
read_package() {
    SERVER_PACKAGES_LIST="${SERVER_PACKAGES[*]}" \
    STATIC_BUNDLERS_LIST="${STATIC_BUNDLERS[*]}" node -e '
const fs = require("fs");
let pkg;
try {
  pkg = JSON.parse(fs.readFileSync(process.argv[1] + "/package.json", "utf8"));
} catch { process.exit(1); }

const question = process.argv[2];
let answer = "";

if (question === "build-script") {
  const scripts = pkg.scripts || {};
  // A demo-site build first: several packages here are libraries whose plain
  // `build` emits a bundle with no HTML, alongside a separate script that
  // builds the browsable demo. Both spellings are in use (`build:demos` in the
  // polyfill packages, `build:demo` in easy-language-model).
  answer = ["build:demos", "build:demo", "build:static", "build"]
    .find((n) => scripts[n]) || "";
} else if (question === "server-dep") {
  const servers = new Set(process.env.SERVER_PACKAGES_LIST.split(" "));
  answer = Object.keys(pkg.dependencies || {})
    .filter((d) => servers.has(d)).join(", ");
} else if (question === "bundler") {
  const bundlers = new Set(process.env.STATIC_BUNDLERS_LIST.split(" "));
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  answer = Object.keys(deps).filter((d) => bundlers.has(d)).join(", ");
}

if (!answer) process.exit(1);
console.log(answer);
' "$1" "$2" 2>/dev/null
}

# Prints the command line of the npm script named $2 in the directory $1.
script_body() {
    node -e '
const fs = require("fs");
try {
  const pkg = JSON.parse(fs.readFileSync(process.argv[1] + "/package.json", "utf8"));
  console.log((pkg.scripts || {})[process.argv[2]] || "");
} catch { console.log(""); }
' "$1" "$2" 2>/dev/null
}

# Decides what to do with the app in the directory $1. Prints
# "<verdict>\t<detail>", where verdict is static, build, or skip.
classify_app() {
    local app_dir="$1"

    # A Chrome extension is installed, not served.
    if grep -rlsq '"manifest_version"' \
        "$app_dir/manifest.json" "$app_dir/public/manifest.json" \
        "$app_dir/src/manifest.json" 2>/dev/null; then
        printf 'skip\tChrome extension, not a website\n'
        return
    fi

    if [ ! -f "$app_dir/package.json" ]; then
        if [ -f "$app_dir/index.html" ]; then
            printf 'static\tno package.json, plain static files\n'
        else
            printf 'skip\tno index.html at the folder root\n'
        fi
        return
    fi

    local server_deps
    if server_deps="$(read_package "$app_dir" server-dep)"; then
        printf 'skip\tneeds a server at runtime (%s)\n' "$server_deps"
        return
    fi

    local build_script bundler
    if build_script="$(read_package "$app_dir" build-script)"; then
        # A build script alone is not enough: `build` may just compile a server
        # or a library. Insist on a recognisable static site bundler.
        if bundler="$(read_package "$app_dir" bundler)"; then
            printf 'build\tnpm run %s\n' "$build_script"
        else
            printf 'skip\tnpm run %s does not build a static site\n' "$build_script"
        fi
        return
    fi

    # A package.json without a build script is usually just a dev-server
    # convenience wrapper around static files. The entry point still has to be
    # an index.html at the folder root: a folder whose only HTML sits in a
    # subdirectory (a library's demo page, say) has nothing to serve at its
    # bucket path.
    if [ -f "$app_dir/index.html" ]; then
        printf 'static\tno build script, plain static files\n'
    else
        printf 'skip\tno build script and no index.html at the folder root\n'
    fi
}

# Installs dependencies for the app in $1. Prefers the lockfile, and falls back
# to a plain install when the lockfile has drifted from package.json.
install_dependencies() {
    local app_dir="$1"
    local install_log="$LOG_DIR/$(slug "$app_dir").install.log"

    if [ -f "$app_dir/package-lock.json" ]; then
        echo "  📦 Installing dependencies (npm ci)..."
        if (cd "$app_dir" && npm ci --no-audit --no-fund --loglevel=error) \
            >"$install_log" 2>&1; then
            return 0
        fi
        echo "  ↩️  npm ci failed, retrying with npm install..."
    else
        echo "  📦 Installing dependencies (npm install)..."
    fi

    if (cd "$app_dir" && npm install --no-audit --no-fund --loglevel=error) \
        >>"$install_log" 2>&1; then
        return 0
    fi

    echo "  ❌ Dependency installation failed. Last lines of $install_log:"
    tail -n 15 "$install_log" | sed 's/^/     /'
    return 1
}

# Builds the app in $1 with the npm script named in $2, for publication under
# the demo name in $3. Prints the path of the directory holding the built site.
# Returns non-zero if the build fails or produces nothing servable.
build_app() {
    local app_dir="$1" build_script="$2" demo_name="$3"
    local build_log="$LOG_DIR/$(slug "$app_dir").build.log"
    local body deploy_base marker candidate output=""
    local -a npm_args=()

    body="$(script_body "$app_dir" "$build_script")"
    deploy_base="$PUBLIC_BASE_PATH$demo_name/"

    local exception override="true"
    for exception in ${BASE_OVERRIDE_EXCEPTIONS[@]+"${BASE_OVERRIDE_EXCEPTIONS[@]}"}; do
        [ "$demo_name" = "$exception" ] && override="false"
    done

    # Tell the bundler where the app will be mounted, so that absolute asset
    # URLs point at the bucket path rather than at the domain root. Some demos
    # hardcode a `base` for a different host; the CLI flag overrides the config.
    if [ "$override" = "false" ]; then
        log "  🔨 Building with $build_script (base left as configured)..."
    elif [[ "$body" == *"vite build"* ]]; then
        npm_args=(-- "--base=$deploy_base")
        log "  🔨 Building with $build_script (base $deploy_base)..."
    elif [[ "$body" == *"react-scripts build"* ]]; then
        export PUBLIC_URL="${deploy_base%/}"
        log "  🔨 Building with $build_script (PUBLIC_URL $PUBLIC_URL)..."
    else
        # Parcel and friends: leave the configured public URL alone.
        log "  🔨 Building with $build_script..."
    fi

    # Timestamp reference, so we can tell a directory this build wrote from a
    # stale one left behind by an earlier run or committed to the repository.
    marker="$LOG_DIR/$(slug "$app_dir").marker"
    : >"$marker"

    if ! (cd "$app_dir" && npm run "$build_script" "${npm_args[@]}") \
        >"$build_log" 2>&1; then
        unset PUBLIC_URL
        log "  ❌ Build failed. Last lines of $build_log:"
        tail -n 15 "$build_log" | sed 's/^/     /' >&2
        return 1
    fi
    unset PUBLIC_URL

    # A build output is only servable if it has an entry point, which also
    # rules out library builds that emit bare JavaScript bundles.
    for candidate in "${OUTPUT_DIR_CANDIDATES[@]}"; do
        if [ -f "$app_dir/$candidate/index.html" ] &&
            [ "$app_dir/$candidate/index.html" -nt "$marker" ]; then
            output="$app_dir/$candidate"
            break
        fi
    done

    if [ -z "$output" ]; then
        log "  ❌ Build succeeded but wrote no index.html to any of:" \
            "${OUTPUT_DIR_CANDIDATES[*]}"
        log "     (a library build, or an output directory this script does" \
            "not know about)"
        return 1
    fi

    log "  📁 Build output: $output"
    printf '%s\n' "$output"
}

# Uploads the directory in $1 to the bucket path for the demo named in $2.
sync_to_bucket() {
    local source_dir="$1" demo_name="$2"
    local destination="$GCS_BUCKET$demo_name"
    local staged

    if ! staged="$(stage_for_upload "$source_dir")"; then
        echo "  ❌ Could not stage $source_dir for upload."
        return 1
    fi

    echo "  ☁️  Syncing $source_dir -> $destination"

    # Uploads occasionally die on a transient error from the Enterprise
    # Certificate Proxy, which signs gcloud's requests with the machine
    # certificate ("ECP Proxy indicated an internal error: Failed to forward
    # request", sometimes as a gcloud crash). A second attempt a few seconds
    # later goes through, so retry before calling the demo failed. rsync
    # resumes rather than starting over: whatever made it up stays up.
    local attempt delay=10 attempts=3

    for ((attempt = 1; attempt <= attempts; attempt++)); do
        # gcloud storage parallelizes on its own (no -m needed).
        # --recursive (-r): recursive sync
        # --delete-unmatched-destination-objects (-d): delete extra files at
        #   destination. No --exclude here on purpose, see EXCLUDE_GLOBS: with
        #   nothing hidden from it, this also cleans up files an earlier run
        #   left behind.
        if gcloud storage rsync "$staged" "$destination" \
            --recursive \
            --delete-unmatched-destination-objects \
            $GCLOUD_DRY_RUN_FLAG; then
            if [ "$DRY_RUN" = "true" ]; then
                echo "  🔎 Dry run output complete for $demo_name. (No changes made)"
            else
                echo "  👍 Synchronization complete for $demo_name."
            fi
            return 0
        fi

        if [ "$attempt" -lt "$attempts" ]; then
            echo "  ↩️  rsync failed for $demo_name (attempt $attempt of $attempts)," \
                "retrying in ${delay}s..."
            sleep "$delay"
            delay=$((delay * 2))
        fi
    done

    echo "  ❌ Warning: gcloud storage rsync failed for $demo_name after $attempts attempts."
    return 1
}

# Lists the repository-relative path of every file in SECRETS_DIR.
secret_paths() {
    [ -d "$SECRETS_DIR" ] || return 0
    find "$SECRETS_DIR" -type f -printf '%P\n' 2>/dev/null
}

# Copies the secrets overlay over the checkout. Must run from the repository
# root, after the clone or reset.
apply_local_secrets() {
    if [ ! -d "$SECRETS_DIR" ]; then
        echo "No secrets directory at $SECRETS_DIR, building with whatever the"
        echo "repository ships. Demos that need an API key may build but not work."
        return 0
    fi

    local rel applied=0
    while IFS= read -r rel; do
        [ -n "$rel" ] || continue
        mkdir -p "$(dirname "$rel")"
        if cp "$SECRETS_DIR/$rel" "$rel"; then
            echo "  🔑 $rel"
            applied=$((applied + 1))
        else
            echo "  ❌ Failed to apply secret $rel" >&2
        fi
    done < <(secret_paths)

    echo "Applied $applied local secret file(s) from $SECRETS_DIR."
}

# -------------------------------------------------------------
# --- Setup ---
echo "Starting synchronization script..."

for tool in git node npm gcloud; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        echo "Error: required tool '$tool' is not on PATH. Exiting." >&2
        exit 1
    fi
done

# gcloud being on PATH says nothing about whether its credential still works.
# An expired or blocked token otherwise only surfaces at the first rsync, which
# is after every demo has already been installed and built, so check the bucket
# up front. --list touches nothing remote, so it does not need this.
if [ "$LIST_ONLY" = "false" ]; then
    echo "Checking access to $GCS_BUCKET..."
    if ! gcloud_error="$(gcloud storage ls "$GCS_BUCKET" 2>&1 >/dev/null)"; then
        echo "Error: cannot reach $GCS_BUCKET. Exiting." >&2
        printf '%s\n' "$gcloud_error" | sed 's/^/  /' >&2
        echo >&2
        echo "Refresh the credential (usually 'gcloud auth login') and re-run," >&2
        echo "or use --list to check the plan without touching the bucket." >&2
        exit 1
    fi
fi

# Work in the workspace, so the same checkout is reused no matter which
# directory the script is invoked from.
if ! mkdir -p "$WORKSPACE_DIR"; then
    echo "Error: cannot create the workspace $WORKSPACE_DIR. Exiting." >&2
    exit 1
fi
cd "$WORKSPACE_DIR" || { echo "Error: cannot enter $WORKSPACE_DIR. Exiting." >&2; exit 1; }
echo "Workspace: $WORKSPACE_DIR"

# 1. Clone or pull the repository
if [ "$DO_PULL" = "false" ]; then
    if [ ! -d "$REPO_DIR" ]; then
        echo "Error: --no-pull given but '$WORKSPACE_DIR/$REPO_DIR' does not exist." >&2
        exit 1
    fi
    echo "Using the existing checkout as-is (--no-pull)."
elif [ -d "$REPO_DIR" ]; then
    echo "Repository directory '$REPO_DIR' already exists. Fetching latest changes..."
    if ! git -C "$REPO_DIR" fetch --prune origin; then
        echo "Error: git fetch failed. Exiting." >&2
        exit 1
    fi

    # The checkout is a build workspace, so nothing in it is worth keeping: the
    # remote always wins. Builds rewrite lockfiles and drop output into the
    # tree, and the secrets overlay edits tracked files, all of which would
    # otherwise block a fast-forward. `reset --hard` also overwrites an
    # untracked file sitting where an incoming one belongs, which a pull
    # refuses to do. The overlay is re-applied right after this.
    if ! upstream="$(git -C "$REPO_DIR" rev-parse --abbrev-ref '@{upstream}' 2>/dev/null)"; then
        upstream="$(git -C "$REPO_DIR" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null)"
    fi
    if [ -z "${upstream:-}" ]; then
        echo "Error: cannot tell which remote branch to reset to. Exiting." >&2
        exit 1
    fi

    dirty="$(git -C "$REPO_DIR" status --porcelain --untracked-files=no | wc -l)"
    [ "$dirty" -gt 0 ] && echo "Discarding local changes to $dirty tracked file(s)."

    if ! git -C "$REPO_DIR" reset --hard "$upstream"; then
        echo "Error: could not reset the checkout to $upstream. Exiting." >&2
        exit 1
    fi
else
    echo "Cloning repository $REPO_URL..."
    if ! git clone "$REPO_URL" "$REPO_DIR"; then
        echo "Error: git clone failed. Exiting." >&2
        exit 1
    fi
fi

# 2. Change into the repository directory
cd "$REPO_DIR" || { echo "Error: Failed to change directory to $REPO_DIR. Exiting." >&2; exit 1; }

# 3. Overlay the local secrets, which the checkout deliberately does not carry.
apply_local_secrets
echo

LOG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/sync-web-ai-demos.XXXXXX")"
trap 'rm -rf "$LOG_DIR"' EXIT

echo "Traversing root-level folders to find demos to publish..."
echo

# 4. Traverse all root-level directories
synced_static=()
synced_built=()
skipped=()
failed=()

for folder in */; do
    folder_name="${folder%/}"

    # Honour --only, when given.
    if [ ${#ONLY_FOLDERS[@]} -gt 0 ]; then
        wanted="false"
        for only in ${ONLY_FOLDERS[@]+"${ONLY_FOLDERS[@]}"}; do
            [ "$folder_name" = "$only" ] && wanted="true"
        done
        [ "$wanted" = "true" ] || continue
    fi

    excluded_by_name="false"
    for excluded in "${EXCLUDED_FOLDERS[@]}"; do
        [ "$folder_name" = "$excluded" ] && excluded_by_name="true"
    done
    if [ "$excluded_by_name" = "true" ]; then
        echo "⛔ Skipping $folder_name: excluded by name"
        skipped+=("$folder_name (excluded by name)")
        continue
    fi

    # The name the demo is published under, which is usually the folder name.
    demo_name="${PUBLISH_AS[$folder_name]:-$folder_name}"

    label="$folder_name"
    [ "$demo_name" != "$folder_name" ] && label="$label -> published as $demo_name"

    # 5. Decide what kind of demo this is.
    IFS=$'\t' read -r verdict detail < <(classify_app "$folder_name")

    if [ "$verdict" = "skip" ]; then
        echo "⛔ Skipping $label: $detail"
        skipped+=("$folder_name ($detail)")
        continue
    fi

    if [ "$verdict" = "build" ] && [ "$DO_BUILD" = "false" ]; then
        echo "⛔ Skipping $label: needs a build and --no-build was given"
        skipped+=("$folder_name (build skipped)")
        continue
    fi

    echo "✅ $label: $verdict — $detail"

    if [ "$LIST_ONLY" = "true" ]; then
        if [ "$verdict" = "build" ]; then
            synced_built+=("$demo_name")
        else
            synced_static+=("$demo_name")
        fi
        continue
    fi

    # 6. Static demos go up as they are; buildable ones are built first.
    if [ "$verdict" = "static" ]; then
        if sync_to_bucket "$folder_name" "$demo_name"; then
            synced_static+=("$demo_name")
        else
            failed+=("$folder_name (sync)")
        fi
        echo
        continue
    fi

    build_script="${detail#npm run }"

    if ! install_dependencies "$folder_name"; then
        failed+=("$folder_name (install)")
        echo
        continue
    fi

    if ! output_dir="$(build_app "$folder_name" "$build_script" "$demo_name")"; then
        failed+=("$folder_name (build)")
        echo
        continue
    fi

    if sync_to_bucket "$output_dir" "$demo_name"; then
        synced_built+=("$demo_name")
    else
        failed+=("$folder_name (sync)")
    fi
    echo
done

# 7. Report
echo "-------------------------------------------------------------"
if [ "$LIST_ONLY" = "true" ]; then
    echo "Plan only (--list): nothing was installed, built, or uploaded."
fi
echo "Static demos (${#synced_static[@]}): ${synced_static[*]:-none}"
echo "Built demos  (${#synced_built[@]}): ${synced_built[*]:-none}"
echo "Skipped      (${#skipped[@]}):"
for entry in ${skipped[@]+"${skipped[@]}"}; do
    echo "  - $entry"
done

if [ ${#failed[@]} -gt 0 ]; then
    echo "Failed       (${#failed[@]}):"
    for entry in "${failed[@]}"; do
        echo "  ❌ $entry"
    done
    echo "Script finished with errors."
    exit 1
fi

echo "Script finished."
