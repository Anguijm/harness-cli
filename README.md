# harness-cli

Bootstrap a complete AI-assisted development harness — Gemini council, Claude Code settings, hooks, CI/CD, secret scanning, and session-state tracking — into any repo with a single command.

```bash
harness init     # full canonical install
harness check    # drift report — what's missing or modified
harness init --update    # add anything missing without touching customizations
```

## What it sets up

Running `harness init` writes the canonical layout into the current repo:

- **`.claude/`** — Claude Code settings, permission allowlist, SessionStart + git-push-safety hooks, and the `close-session` skill.
- **`.harness/`** — multi-persona Gemini council (architecture, security, bugs, cost, product, accessibility, maintainability + lead-architect resolver), runner script, post-commit hook, learnings log, halt instructions, model-upgrade checklist.
- **`.github/workflows/`** — CI (lint + typecheck + test + gitleaks), council review on every PR (with monthly budget cap and serialized pre-flight to prevent races), and post-hoc branch guard.
- **`.husky/pre-push`** (Node/TS only) — local lint + typecheck before any push.
- **`.gitleaks.toml`** — secret scanning, runs before any LLM call.
- **`scripts/setup-secrets.sh`** — one-time per-machine sync of API keys to a new repo (no per-project Gemini key wrangling).
- **`CLAUDE.md`**, **`harness.yml`** — operating doctrine + config.

Stack auto-detected from `package.json` / `requirements.txt`; CI workflow and hooks adjust accordingly.

## Quick start

```bash
cd my-project
npx harness-cli init
bash .harness/scripts/install_hooks.sh          # wire the post-commit hook
bash scripts/setup-secrets.sh                    # sync GEMINI_API_KEY etc. to repo
```

Then specialize the personas — the generic skeletons in `.harness/council/*.md` produce generic critiques. Edit each persona's `## Scope` section to match this repo's actual modules and contracts.

## Commands

| Command | What it does |
|---|---|
| `harness init` | Fresh install. Errors if `.harness/` exists. |
| `harness init --update` | Add missing files; preserve existing ones. Safe to re-run. |
| `harness init --force` | Overwrite everything (destructive). |
| `harness check` | Read-only drift report. Exits 1 if anything's missing. |
| `harness plan "feature"` | (legacy) Anthropic-powered planning. v0.1 path. |

## How the council works

On every PR, `.github/workflows/council.yml`:
1. Runs gitleaks against the diff (fails before any LLM sees secrets).
2. Checks the monthly Gemini-call budget (serialized across all PRs in the repo).
3. Dispatches every persona in `.harness/council/*.md` against the diff in parallel.
4. Synthesizes via the Lead Architect persona.
5. Posts a single re-editable PR comment with verdict 🟢 CLEAR / 🟡 CONDITIONAL / 🔴 BLOCK.

Local invocation: `python3 .harness/scripts/council.py --plan .harness/active_plan.md` or `--diff --base origin/main`.

Skip directives: `[skip council]` in PR title bypasses for that PR. `.harness_halt` at repo root halts everything until removed.

## Customization

- **Personas**: edit `.harness/council/<angle>.md`. New personas auto-discovered. Disable by renaming to `.md.disabled`.
- **Diff exclusions**: `HARNESS_DIFF_EXCLUDES` env var (comma-separated pathspec) or edit `_DEFAULT_DIFF_EXCLUDES` in `council.py`.
- **Monthly budget**: `MONTHLY_CAP` in `.github/workflows/council.yml`.
- **Per-run cap**: `CALL_CAP` in `council.py` (default 15, includes retries).

## Philosophy

- **Plan before code.** The harness reviews intent, not just output.
- **Multiple perspectives.** Seven personas catch what one misses.
- **Human in the loop.** No verdict auto-merges. Circuit breaker is sacred.
- **Compounds across sessions.** `learnings.md` accumulates institutional knowledge so future Claude sessions don't relearn the same lessons.
- **Cost-disciplined.** Hard per-run cap, monthly budget, gitleaks pre-flight.

## Repo layout (after `harness init`)

```
your-repo/
├── .claude/
│   ├── settings.json
│   ├── hooks/
│   └── skills/close-session.md
├── .harness/
│   ├── council/                # personas — edit per repo
│   ├── scripts/council.py      # the runner
│   ├── hooks/post-commit
│   ├── active_plan.md
│   └── learnings.md
├── .github/workflows/
│   ├── ci.yml
│   ├── council.yml
│   └── branch-guard.yml
├── .husky/pre-push
├── .gitleaks.toml
├── scripts/setup-secrets.sh
├── CLAUDE.md
└── harness.yml
```

## Roadmap

- **v0.2** (current): canonical template + init/check/update; settings hooks; budget race fix; close-session skill; auto-PR-watching rule
- **v0.3**: per-stack lint/test scaffolding; pre-commit hook framework alongside husky; specialized persona generators
- **v0.4**: optional template-repo mode (`gh repo create --template`) so init isn't needed for new projects
