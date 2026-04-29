# Claude Code Operating Protocol — {{PROJECT_NAME}}

This file loads automatically at the start of every Claude Code session. Rules here are durable context the model should follow without re-explanation.

## The council is the audit gate

Every change to `main` goes through a PR. `.github/workflows/council.yml` runs a multi-persona Gemini review on every PR open + push. The Lead Architect synthesis posts a single re-editable PR comment with a verdict: 🟢 CLEAR | 🟡 CONDITIONAL | 🔴 BLOCK.

**Direct pushes to `main` are flagged by `.github/workflows/branch-guard.yml`** — a post-hoc detector that fails on any push to `main` whose head commit is not associated with a merged PR. Detection, not prevention (GitHub Pro required for hard-block).

**Default: do not merge without 🟢.** CONDITIONAL = address remediations in a follow-up commit; council auto-reruns. BLOCK = rethink the change.

`[skip council]` in the PR title bypasses the workflow entirely; reserved for emergency hotfixes and trivial mechanical changes.

## Plan-first workflow

For any non-trivial change:

1. **Write a plan** in `.harness/active_plan.md`. Commit it (the council refuses to run against an untracked plan file).
2. **Run the local council** if you want pre-PR review: `python3 .harness/scripts/council.py --plan .harness/active_plan.md`.
3. **Implement**, smallest diff that achieves the plan.
4. **Push and let CI council run.** Address remediations as follow-up commits on the same branch.
5. **Merge after 🟢.**

## Pull requests — do not auto-create

**Do NOT create a pull request unless the user explicitly asks for one.** `mcp__github__create_pull_request` is in `.claude/settings.json` under `permissions.ask`, so Claude Code prompts every time.

- "Commit and push" ≠ "open a PR". Push to the remote and stop.
- If a PR already exists for the branch, don't open a duplicate.

## Watch PRs automatically

**As soon as a PR is opened (by you or by the user), call `mcp__github__subscribe_pr_activity` to listen for PR events.** Don't wait to be asked. The council takes ~3 minutes to post its verdict; codex review comments arrive on a similar timeline; CI failures arrive as soon as a check completes. Subscribing is the right way to react in time without polling.

When events arrive:
- **Council comment (`<!-- council-report -->`)** — read the verdict. CLEAR = nothing to do. CONDITIONAL = address remediations as follow-up commits. BLOCK = pause and discuss with the user before proceeding.
- **Codex review comments** — sometimes GitHub adds Codex review comments alongside the council. Treat them as another reviewer; respond if the comment is actionable, or explain in a reply if it's not.
- **CI failures** — read the log, fix or surface the issue. Don't ignore.
- **User comments** — defer to user direction.

If the user closes the session before events arrive, that's fine — the next session can re-subscribe.

## Communication style

Default to plain language. Tell the user what you're doing in normal words ("committing your changes", "checking the council verdict", "pushing"), not in code or file paths. Surface technical detail (diffs, commands, file lists) only when the user asks or when a decision genuinely depends on it.

## Closeout

When the user says "close the session", "wrap up", or similar, run the `close-session` skill (`.claude/skills/close-session.md`). It commits, pushes, refreshes the handoff doc, appends to learnings, and verifies the branch is clean so the next session can pick up cold.

## Git hygiene (enforced by `.claude/hooks/check-branch-not-merged.sh`)

Before any `git push`, the harness fetches `origin/main` and refuses the push if the current branch has no content-difference from `origin/main` (the signature of a squash-merged branch). `git commit` is intentionally NOT intercepted.

If the hook fires: create a fresh branch from `origin/main`:

```bash
git fetch origin main
git checkout -b <new-branch> origin/main
```

## Halt protocol

If automation is producing bad output: `echo "reason" > .harness_halt` at repo root. The council and any cron workflows will silent-exit. See `.harness/halt_instructions.md`.

## What lives where

<!-- Specialize this section for the repo. Examples:
- `src/` — main source
- `tests/` — test suite
- `.harness/` — council personas, scripts, session state
- `.claude/` — Claude Code settings + hooks
- `.github/workflows/` — CI + council + branch-guard
-->

## Repo-specific notes

<!-- Add anything Claude needs to know about this repo: stack quirks, deploy
targets, known tech debt, naming conventions, etc. -->
