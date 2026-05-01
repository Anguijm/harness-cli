# Phase E plan — sensor honesty (the "ship without review" work)

## Goal

Get the harness's computational and inferential sensors honest enough that a 🟢 CLEAR verdict can be **trusted at a glance** — no manual reading of council output before merging. The OpenAI / Lopopolo target is "1M lines of code, no human review." Phase A–D got us a credible advisory verdict; Phase E is what makes the verdict load-bearing.

## Vocabulary recap

- **Computational sensors** — deterministic checks (lint, typecheck, tests, gitleaks, branch-guard, drift-check). Cheap, fast, narrow.
- **Inferential sensors** — the council. Wider scope, slower, probabilistic.
- **Sensor honesty** — when both kinds catch real problems with low false-positive rate AND the catches block merge automatically.

The harness today: sensors fire, but a human still has to read the output and decide whether to merge. Phase E removes that step where it's safe.

## Four components

### E.1 — Computational results in the council prompt (smallest, immediate value)

Today `council.py` sees only the git diff. The computational sensors run in parallel jobs but their output never reaches the council's prompt. So the council can't say "the typecheck flagged a real type error on line 42" — it can only re-discover that from reading the diff.

**Change:** before invoking Gemini, council.py reads the most recent CI run artifacts for the same SHA (lint output, typecheck output, test failures, gitleaks SARIF) and injects them as a `=== COMPUTATIONAL SENSOR RESULTS ===` block in every persona prompt.

**Effort:** ~half day. Mechanical:
- New helper in council.py that calls `gh api repos/.../check-runs` for the head SHA
- Concatenates failure logs (truncated to a budget) into the prompt
- Personas get explicit guidance: "If a computational sensor caught the issue, you don't need to re-litigate it — focus on what the sensor missed."

**Risk:** prompt size growth. Cap the injected block at ~2K tokens; truncate stderr tails. Test cost impact on the next live council run.

**Why first:** purely additive. Doesn't change any merge gate; it makes verdicts more grounded. Quick win that benefits every consumer repo immediately when they bump `HARNESS_VERSION`.

### E.2 — Post-merge smoke + auto-revert

Today: once a PR merges, nothing runs against `main` to catch a regression that slipped through. If the test suite was incomplete (mutation score is low — see E.3), bugs land silently.

**Change:** new workflow `.github/workflows/post-merge-smoke.yml` that runs on `push: branches: [main]`, executes a curated smoke-test set (different from the full test suite — focused on critical paths), and on failure either:
- **Conservative:** opens a tracking issue + posts a comment on the original PR.
- **Aggressive:** opens a revert PR automatically with the merge commit as the candidate. Human reviews+merges to revert.
- **Most aggressive:** force-pushes a revert directly. Probably never want this.

**Effort:** ~1 day. The smoke-test set has to be defined per-repo (each repo declares which tests are smoke vs full). Add `harness.yml` field `smoke_tests:` that points at a path or pattern.

**Risk:** false-positive revert PRs. Mitigated by conservative mode by default; aggressive auto-revert only when smoke set is well-curated.

### E.3 — Mutation testing

Mutation testing answers: "does the test suite actually catch the bugs we'd care about?" by introducing tiny code mutations and checking if any test fails.

**Change:** weekly cron workflow that runs StrykerJS (Node) or mutmut (Python) against the test suite, generates a mutation score, and opens an issue if score drops below a threshold.

**Effort:** ~2 days. Per-stack tooling. StrykerJS for node-ts repos, mutmut for python repos. Configuration files, threshold values.

**Risk:** mutation testing is slow (10–60 min depending on suite size) and noisy. Not every mutation matters. Start advisory-only (no merge gate); raise to gating once thresholds are calibrated.

**Why third:** biggest investment, longest tail. Without it, "tests pass" doesn't mean "tests would catch the bug" — but with it, we can finally trust green CI as evidence of robustness.

### E.4 — Branch protection (GitHub gates the merge button)

Today: `branch-guard.yml` is a post-hoc detector. A direct push to main fails the guard but the push has already landed. The fix requires GitHub branch protection rules that hard-block.

**Change:** scripted setup that uses `gh api` (or the org admin UI for orgs) to set rules:
- Require status check `council` to pass before merge
- Require status check `validate` (or `ci/validate`) to pass before merge
- Restrict who can push to main (admins + automation only)
- Disallow force-push to main

**Effort:** half day. Mostly a setup script (`scripts/setup-branch-protection.sh`) plus documentation for the manual steps GitHub Pro requires for hard blocks on private repos.

**Risk:** the only one — GitHub Pro/Team is required for hard branch protection on private repos. The user's repos appear to be private; if they're on free tier, branch protection rules can be set but aren't enforced for admins. Soft-fence-only mode is the realistic target until the org upgrades.

**Why fourth:** value is gated on the org tier. Worth scripting now so when the upgrade happens the rules apply with one command, but not the highest leverage in the meantime.

## Sequencing recommendation

```
E.1  ──▶  E.2  ──▶  E.3        E.4 (parallel, gated on Pro tier)
prompt   smoke      mutation      branch
inject   tests      testing       protection
~1/2d    ~1d        ~2d           ~1/2d
```

Total: ~4 days of work spread across four sub-PRs. Each lands as a separate canonical change with its own council review.

After all four: 🟢 CLEAR verdict + green CI is genuinely trustworthy without human read. Merge button can be pressed by automation when both fire. That's the "1M lines no review" gate.

## Open decisions before starting

1. **E.2 default mode.** Conservative (issue + PR comment) or aggressive (auto-revert PR)? Recommend conservative as the canonical default; repos that want auto-revert can flip a flag in `harness.yml`.
2. **E.3 stack coverage.** Start with node-ts (StrykerJS) or python (mutmut) first? Recommend node-ts since most consumer repos are TS. Add python as a follow-up.
3. **E.3 mutation threshold.** What's the failing score? 60% kill rate is industry middle-of-the-road; lower means the suite has lots of dead tests. Recommend advisory-only at first, calibrate per repo, then gate at the worst observed score minus 5%.
4. **E.4 enforcement scope.** Only main, or also feature branches that are PR'd? Recommend main-only to start.
5. **Where do smoke tests live?** Recommend `tests/smoke/` (or `__tests__/smoke/`) by convention, with `harness.yml` pointing at the glob.

## What this plan does NOT cover

- **Auto-merge on green** (the CI/council green = bot merges). That's a follow-up to E.4 once branch protection works. Out of scope here.
- **Production canary deploys.** That's deployment infrastructure, not harness scope.
- **Rollback automation in production.** Same.

The harness scope ends at "merge to main is safe." Production safety is downstream.

## Implementation order I'd start with

If approved, execute as four PRs over ~4 days:

1. PR: `feat(council): inject computational sensor results into persona prompts` (E.1)
2. PR: `feat(workflow): post-merge smoke test with conservative tracking-issue mode` (E.2 conservative)
3. PR: `feat(council): weekly mutation-testing cron + advisory issue` (E.3 advisory)
4. PR: `chore: branch-protection setup script + doctrine` (E.4)

Each gets its own council review. The plan doc itself (this file) lands first as a navigational artifact.
