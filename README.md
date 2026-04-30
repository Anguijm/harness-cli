# harness-cli

A complete AI-assisted development harness — Gemini council, Claude Code settings, hooks, CI/CD, secret scanning, and steering-loop bookkeeping — bundled as a **GitHub template repo**. Clone it, run one bootstrap command, and your new project ships with the canonical topology in place.

## What you get

The **topology** that gets installed:

- **`.claude/`** — Claude Code settings, permission ask-list, SessionStart + git-push-safety hooks, the `close-session` skill.
- **`.harness/`** — multi-persona Gemini **council** (architecture, security, bugs, cost, product, accessibility, maintainability + lead-architect resolver), runner script, post-commit hook, learnings log, halt circuit breaker, model-upgrade checklist.
- **`.github/workflows/`** — CI (lint + typecheck + test + gitleaks), council review on every PR (serialized monthly budget cap), post-hoc branch guard, weekly drift detection.
- **`.husky/pre-push`** (Node/TS only) — local lint + typecheck before any push.
- **`.gitleaks.toml`** — secret scanning, runs before any LLM call.
- **`scripts/setup-secrets.sh`** — one-time machine-level sync of API keys (no per-project Gemini key wrangling).
- **`CLAUDE.md`**, **`harness.yml`** — operating doctrine + config.

Stack auto-detected from `package.json` / `requirements.txt`.

## Vocabulary

This repo follows the **harness engineering** discipline:

- **Guides** (feedforward) — direct behavior before it happens. CLAUDE.md, council personas, security checklist, settings, skills.
- **Sensors** (feedback) — observe behavior and gate or alert after. gitleaks, lint, typecheck, tests, the council, branch-guard.
- **Topology** — the canonical layout tying guides + sensors together. What this repo emits.
- **Steering loop** — append-only `learnings.md` discipline of refining guides when sensors catch what they should have prevented.

Slogan: **structure in, structure out.**

---

## Primary path: clone-and-go

The intended workflow for new projects. Zero CLI install, zero per-project Gemini key.

### One-time setup (per machine)

```bash
mkdir -p ~/.config/harness
cat > ~/.config/harness/secrets.env <<'EOF'
GEMINI_API_KEY=your-key-here
ANTHROPIC_API_KEY=your-key-here
EOF
chmod 600 ~/.config/harness/secrets.env
```

### Each new project

```bash
gh repo create my-project --template Anguijm/harness-cli --clone --public
cd my-project
bash bootstrap.sh
```

That's it. `bootstrap.sh`:
1. Substitutes `{{PROJECT_NAME}}` everywhere using your repo name.
2. Removes the CLI scaffolding (you don't need it after bootstrap).
3. Wires the post-commit hook and makes scripts executable.
4. Syncs the secrets from `~/.config/harness/secrets.env` to the repo's GitHub Actions secrets.
5. Prints what to specialize next.

After bootstrap, you have a fresh repo with the full canonical topology, named correctly, with secrets in place. Make your first commit and push.

### Bootstrap options

```bash
bash bootstrap.sh                    # defaults — substitute, clean up, hook, sync secrets
bash bootstrap.sh --skip-secrets     # don't try to push secrets (use if no gh auth yet)
bash bootstrap.sh --skip-cleanup     # keep src/, test/, templates/ — useful for hacking on the harness
bash bootstrap.sh --stack=python     # override stack auto-detection
bash bootstrap.sh --force            # bootstrap even if origin is harness-cli source
```

---

## Secondary path: sync into an existing repo

For repos that already exist and need the harness retrofitted. Requires Node 20+.

```bash
cd existing-project
git clone --depth 1 https://github.com/Anguijm/harness-cli.git /tmp/harness-cli
cd /tmp/harness-cli && npm ci
cd -
node /tmp/harness-cli/src/cli.js init --update    # add missing files only
node /tmp/harness-cli/src/cli.js check             # drift report
```

| Command | What it does |
|---|---|
| `harness init` | Fresh install. Errors if `.harness/` already exists. |
| `harness init --update` | Add missing files; preserve existing ones. Safe to re-run. |
| `harness init --force` | Overwrite everything (destructive). |
| `harness check` | Read-only drift report. Exits 1 if anything's missing. |
| `harness map "<feature>"` | Repository Impact Map — scan repo, list real files for the next plan. |

---

## Specialize after bootstrap

The personas in `.harness/council/*.md` ship as generic skeletons. **They will produce generic critiques until specialized.** Edit each persona's `## Scope` section to describe:
- This repo's actual modules and their boundaries.
- The contracts other code or repos depend on.
- The security surface (auth model, trust boundaries, secret handling).
- The cost drivers (LLM calls, external services, storage).

Same for `.harness/scripts/security_checklist.md` — generic non-negotiables at the top, repo-specific items added below.

## How the council works

On every PR, `.github/workflows/council.yml`:
1. Runs gitleaks against the diff (fails before any LLM sees secrets).
2. Checks the monthly Gemini-call budget (serialized pre-flight job — no race conditions).
3. Dispatches every persona in `.harness/council/*.md` against the diff in parallel.
4. Synthesizes via the Lead Architect persona.
5. Posts a single re-editable PR comment with verdict 🟢 CLEAR / 🟡 CONDITIONAL / 🔴 BLOCK.

Local invocation: `python3 .harness/scripts/council.py --plan .harness/active_plan.md` or `--diff --base origin/main`.

Skip directive: `[skip council]` in PR title bypasses for that PR.
Halt: `.harness_halt` at repo root stops the council and any cron workflows until removed.

## Repository Impact Map (pre-plan grounding)

Before writing a plan, run:

```bash
node /tmp/harness-cli/src/cli.js map "your feature description" --write
```

This scans the actual codebase and prepends a `## Repository Impact` block to `.harness/active_plan.md` — listing the real files, symbols, and tests likely to be touched. Closes the "vague in, vague out" failure mode (AI plans referencing hallucinated paths).

## Drift detection

Each repo gets a `drift-check.yml` workflow that runs weekly. It checks out harness-cli alongside, runs `harness check`, and opens (or comments on) a tracking issue if anything's missing or modified. Catches when a workflow file or persona is edited without going through the proper flow.

## Customization knobs

- **Personas**: edit `.harness/council/<angle>.md`. New personas auto-discovered. Disable by renaming to `.md.disabled`.
- **Diff exclusions**: `HARNESS_DIFF_EXCLUDES` env var (comma-separated pathspec) or edit `_DEFAULT_DIFF_EXCLUDES` in `council.py`.
- **Monthly council budget**: `MONTHLY_CAP` in `.github/workflows/council.yml`.
- **Per-run council cap**: `CALL_CAP` in `council.py` (default 15, includes retries).

## Repo layout (after bootstrap)

```
your-repo/
├── .claude/
│   ├── settings.json
│   ├── hooks/
│   └── skills/close-session.md
├── .harness/
│   ├── council/                  # personas — specialize per repo
│   ├── scripts/council.py        # the council runner
│   ├── hooks/post-commit
│   ├── active_plan.md
│   └── learnings.md
├── .github/workflows/
│   ├── ci.yml
│   ├── council.yml
│   ├── branch-guard.yml
│   └── drift-check.yml
├── .husky/pre-push               # node-ts only
├── .gitleaks.toml
├── scripts/setup-secrets.sh
├── CLAUDE.md
└── harness.yml
```

## Enabling this repo as a GitHub template

If you've forked this repo and want `gh repo create --template` to work against your fork, mark it as a template:

```bash
gh api -X PATCH /repos/<your-user>/harness-cli -f is_template=true
```

(Or via the GitHub UI: Settings → General → check "Template repository".)

## Philosophy

- **Plan before code.** The harness reviews intent, not just output.
- **Multiple perspectives.** Seven personas catch what one misses.
- **Human in the loop.** No verdict auto-merges. Circuit breaker is sacred.
- **Compounds across sessions.** `learnings.md` is the steering-loop record so future Claude sessions don't relearn the same lessons.
- **Cost-disciplined.** Hard per-run cap, monthly budget, gitleaks pre-flight, serialized budget reservation.

## Roadmap

- **v0.2** (current): canonical topology, init/check/update/map, bootstrap.sh, drift detection, industry-norm vocabulary.
- **v0.3**: post-merge sensors (smoke tests, mutation testing), branch protection auto-config, topology variants per common stack.
- **v0.4**: pre-bundled topologies for "next-app + firestore", "python data pipeline", etc., so personas ship pre-specialized.
