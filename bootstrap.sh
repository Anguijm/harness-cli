#!/usr/bin/env bash
# bootstrap.sh — one-shot setup for a fresh template clone of harness-cli.
#
# Workflow:
#   gh repo create my-project --template Anguijm/harness-cli --clone
#   cd my-project
#   bash bootstrap.sh
#
# What it does (in order):
#   1. Verifies we're in a git repo and not on harness-cli source itself.
#   2. Runs the bundled CLI (src/cli.js init --force) to regenerate every
#      canonical file with the correct project name substituted in.
#   3. Removes the CLI scaffolding (src/, test/, templates/, package.json,
#      etc.) since a templated copy doesn't need them.
#   4. Wires the post-commit hook and makes scripts executable.
#   5. Syncs API keys from ~/.config/harness/secrets.env to this repo's
#      GitHub Actions secrets, if a remote is configured.
#   6. Prints next steps.
#
# Idempotent — safe to re-run after the first bootstrap (it'll just regenerate
# any files you haven't customized yet). Safe — refuses to run on harness-cli
# source unless --force is passed.

set -eu

FORCE=0
SKIP_CLEANUP=0
SKIP_SECRETS=0
STACK="auto"
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --skip-cleanup) SKIP_CLEANUP=1 ;;
    --skip-secrets) SKIP_SECRETS=1 ;;
    --stack=*) STACK="${arg#--stack=}" ;;
    -h|--help)
      grep -E '^#( |$)' "$0" | sed 's/^# \?//'
      exit 0
      ;;
  esac
done

# Refuse to run outside a git repo. Otherwise we could rename files in
# unrelated trees.
if ! REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  echo "[bootstrap] Not inside a git repo. cd into your project first." >&2
  exit 1
fi
cd "$REPO_ROOT"

# Refuse to run on harness-cli source. Detect via git remote URL.
ORIGIN_URL="$(git remote get-url origin 2>/dev/null || true)"
if [[ "$ORIGIN_URL" == *"Anguijm/harness-cli"* ]] && [ "$FORCE" -ne 1 ]; then
  echo "[bootstrap] Origin is the harness-cli source repo ($ORIGIN_URL)."
  echo "[bootstrap] No-op. If you cloned harness-cli to use as a project, change"
  echo "[bootstrap] the remote first (gh repo create / git remote set-url) and re-run."
  echo "[bootstrap] Or pass --force to bootstrap on top of the source repo (rare)."
  exit 0
fi

# Confirm we have the CLI bundle. Without it we can't regenerate canonical files.
if [ ! -f "src/cli.js" ] || [ ! -d "templates" ]; then
  echo "[bootstrap] Missing src/cli.js or templates/ — this doesn't look like a"
  echo "[bootstrap] harness-cli template clone. Aborting." >&2
  exit 1
fi

# Confirm Node is available (the CLI needs it).
if ! command -v node >/dev/null 2>&1; then
  echo "[bootstrap] Node.js is required to bootstrap. Install Node 20+ and re-run." >&2
  exit 1
fi

# Determine project name (for log output only — the CLI handles its own).
PROJECT_NAME=""
if [ -n "$ORIGIN_URL" ]; then
  PROJECT_NAME="$(basename "$ORIGIN_URL" .git)"
fi
[ -z "$PROJECT_NAME" ] && PROJECT_NAME="$(basename "$REPO_ROOT")"
echo "[bootstrap] Project: $PROJECT_NAME"

# --- 1. Install CLI deps + run init --force. ---
echo "[bootstrap] Installing CLI deps..."
if [ -f package-lock.json ]; then
  npm ci --silent --no-audit --no-fund
else
  npm install --silent --no-audit --no-fund
fi

echo "[bootstrap] Regenerating canonical files via harness init..."
node src/cli.js init --force --stack "$STACK"

# --- 2. Remove CLI scaffolding. ---
if [ "$SKIP_CLEANUP" -ne 1 ]; then
  REMOVED=()
  for path in src test templates package.json package-lock.json node_modules .nvmrc bootstrap.sh; do
    if [ -e "$path" ]; then
      rm -rf "$path"
      REMOVED+=("$path")
    fi
  done
  if [ "${#REMOVED[@]}" -gt 0 ]; then
    echo "[bootstrap] Removed CLI scaffolding: ${REMOVED[*]}"
  fi
fi

# --- 3. Wire hooks + chmod scripts. ---
if [ -d .harness/hooks ] && [ -x .harness/scripts/install_hooks.sh ]; then
  bash .harness/scripts/install_hooks.sh || echo "[bootstrap] (hook install reported non-zero, continuing)"
fi
[ -d .claude/hooks ] && chmod +x .claude/hooks/* 2>/dev/null || true
[ -d .husky ] && chmod +x .husky/* 2>/dev/null || true
[ -d scripts ] && chmod +x scripts/* 2>/dev/null || true

# --- 4. Sync secrets from ~/.config/harness/secrets.env. ---
if [ "$SKIP_SECRETS" -ne 1 ] && [ -f scripts/setup-secrets.sh ]; then
  if [ -n "$ORIGIN_URL" ]; then
    echo "[bootstrap] Syncing secrets..."
    bash scripts/setup-secrets.sh || echo "[bootstrap] Secrets sync skipped or failed (run scripts/setup-secrets.sh later)."
  else
    echo "[bootstrap] No git remote — skipping secrets sync."
    echo "[bootstrap]   After 'gh repo create', run: bash scripts/setup-secrets.sh"
  fi
fi

# --- 5. Done. ---
cat <<EOF

[bootstrap] Done.

Next steps:
  1. Specialize personas: edit .harness/council/*.md ## Scope sections.
  2. Specialize CLAUDE.md: fill in 'What lives where' and 'Repo-specific notes'.
  3. Edit security_checklist: .harness/scripts/security_checklist.md.
  4. First commit:
       git add -A && git commit -m 'chore: bootstrap from harness-cli template'
       git push -u origin main
  5. Open a PR for your first real change and watch the council run.
EOF
