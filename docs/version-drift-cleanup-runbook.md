# Version-drift cleanup runbook

> Precondition for the verification-scaling rollout (`docs/verification-scaling-audit.md`, step 2). Goal: get every canonical-inheritor onto a single known baseline so the future T1/T2 council upgrade propagates cleanly via `HARNESS_VERSION` bump instead of into a tangle of different starting versions.

## The finding that shapes this plan

`harness check` (`src/commands/check.js`) exits non-zero **only when a canonical template file is _missing_** from the repo. Content differences register as `modified` and are explicitly tolerated (repos are expected to customize personas + security checklist).

Diffing the template tree between **V0.2.1** (`c9a5bede`) and **V0.3.1** (`12a9f3fe`) shows:

- `templates/github/workflows/` — same 5 filenames; only `ci-node`, `ci-python`, `council`, `drift-check` **contents** changed.
- `templates/harness/` (top level), `scripts/`, `council/` — **same filenames at both versions.** Only `council.py`, `council/architecture.md`, and `council/lead-architect.md` contents changed. `install_hooks.sh`, `requirements.txt`, `security_checklist.md`, and 7 of 9 personas are byte-identical.

**→ V0.2.1 → V0.3.1 introduces no new files.** So a stale pin does **not** fail drift-check, and bumping a pin is not gated on adding files. The real blockers are structural, not version-number drift.

## Pin reference

| Version | SHA (immutable, for `HARNESS_SHA`) |
|---|---|
| V0.2.1 | `c9a5bedea63afbc4e94b3f0625de32836ccda0c5` |
| V0.3.0 | `519a3f5fd1474c8f24d188b298c60bad1f62ca76` |
| **V0.3.1 (current canonical HEAD)** | `12a9f3fe5fed4f8a7ebdfc1eb97838f8a750537d` |

## Current state (canonical source + 6 inheritors + self)

| Repo | HARNESS_VERSION | HARNESS_SHA | Structural issue |
|---|---|---|---|
| **harness-cli** (self) | V0.2.1 | c9a5bede | **Self-pin stale** — repo *is* V0.3.1 but its own drift-check compares against V0.2.1 |
| llmwiki-nodep | V0.3.0 | 519a3f5f ✓ | none (best hygiene — both lines present) |
| sportsdata | V0.2.1 | *(tag only, no SHA?)* | **Missing HARNESS_SHA** breaks the SHA-pinned checkout |
| roadtripper | V0.2.1 | *(tag only, no SHA?)* | **Missing HARNESS_SHA** |
| presentation | V0.2.1 | c9a5bede ✓ | none |
| city-atlas-service | V0.2.1 | *(present)* | **`harness.yml` still has `{{PLACEHOLDER}}`s** (never initialized) |
| llmwiki_studygroup | *(none)* | *(none)* | **Detached copy** — no `harness.yml`, no `drift-check.yml`; cannot inherit via version bump at all |
| yolo-projects | V0.3.1 | 12a9f3fe ✓ | none — already current (divergent council, tracked separately) |

## The actual blockers (fix these — everything else is cosmetic)

1. **llmwiki_studygroup is a detached canonical copy.** No pin file exists, so no `HARNESS_VERSION` bump can ever reach it — the backport mechanism is severed. This is the one repo where "version drift" is real and total.
2. **harness-cli's self-pin lies.** The canonical repo claims V0.2.1 against itself while sitting at V0.3.1 — anyone reading it as the reference gets the wrong version. Fix first; it sets the baseline everyone else pins to.
3. **city-atlas-service `harness.yml` is uninitialized.** Placeholder tokens mean the council reads a garbage model/specialized config. `harness check` tolerates it (file present = not missing), so it silently persists.
4. **Two repos pin a tag with no SHA.** `drift-check.yml` checks out canonical via `ref: ${{ env.HARNESS_SHA }}`; an empty `HARNESS_SHA` makes that checkout undefined. These drift-checks may be silently broken.

## Recommended sequencing — two phases, not one

Because the future **T1/T2 release (V0.4.0)** will itself rewrite `council.py`, `harness.yml`, and the persona output format, doing a full *content* refresh to V0.3.1 now would touch those same files **twice**. Longevity-best (minimize churn, one source of truth): split into cheap-now vs. bundle-with-V0.4.0.

### Phase 0 — structural fixes (do now; independent of V0.4.0)

These are genuine bugs, not version-choice, and none depend on the T1/T2 work:

- [ ] **harness-cli**: bump its own `.github/workflows/drift-check.yml` to `V0.3.1` / `12a9f3fe`. *(One file, this repo, this branch.)*
- [ ] **llmwiki_studygroup**: add `harness.yml` (canonical, 7-persona, `gemini-2.5-pro`, `specialized: false`) + `.github/workflows/drift-check.yml` pinned to `V0.3.1` / `12a9f3fe`. Run `harness check` to confirm no missing files. Re-attaches it to the backport chain.
- [ ] **city-atlas-service**: complete `harness init` to fill the `{{PROJECT_NAME}}` / `{{STACK}}` / `{{INSTALL_CMD}}` placeholders in `harness.yml`; commit.
- [ ] **sportsdata, roadtripper**: add the missing `HARNESS_SHA` line alongside their existing `HARNESS_VERSION` (`V0.2.1` → `c9a5bede` for now, or straight to V0.3.1 in Phase 1). Restores the SHA-pinned checkout.

Each is a small PR, gated by that repo's own council. **Cron-pause note:** sportsdata's `predict-cron.yml` runs 05:00 & 22:00 UTC and its backfill/ratchet jobs are long; none of the Phase-0 edits touch `.harness/` state files, so no pause is required for sportsdata here (pause only when a PR restructures files a cron reads/writes — see yolo's CLAUDE.md protocol).

### Phase 1 — content conformance, bundled with the T1/T2 V0.4.0 release

When T1/T2 ships as V0.4.0, each inheritor does **one** content-conformance bump straight to V0.4.0 (skip an interim V0.3.1 refresh so `council.py` is touched once):

1. Bump `HARNESS_VERSION` / `HARNESS_SHA` to V0.4.0.
2. Refresh the files whose canonical content changed — `council.py`, `council/architecture.md`, `council/lead-architect.md`, the workflows, and the changed `CLAUDE.md` / `harness.yml` sections — **re-applying each repo's known customizations**:
   - sportsdata: specialized personas (data-quality / statistical-validity / prediction-accuracy / domain-expert), `review_granularity`, `ratchet` block.
   - presentation: specialized personas + repo-local security-checklist → `code-craft` routing.
   - yolo-projects: its entire divergent council is *not* refreshed from canonical — apply T1/T2 to it by hand (audit step 4).
   - branch-guard carve-outs (yolo/sportsdata cron actors) preserved.
3. For repos still on the legacy `google-generativeai` SDK (**llmwiki-nodep, llmwiki_studygroup**), the V0.4.0 `council.py` refresh *is* the SDK migration to `google-genai` — add the dep + confirm `GEMINI_API_KEY` wiring.
4. **Cron-pause** for the two autonomous repos (yolo `tick_tock.yml`, sportsdata `predict-cron.yml`) across the merge window, per yolo's documented protocol, since the refresh rewrites `.harness/scripts/council.py` that the cron invokes. Re-enable + manual-trigger verify after merge.

## Verification (per repo, after each change)

- Trigger `drift-check.yml` via `workflow_dispatch` and confirm exit 0 (no missing files).
- Confirm the drift tracking issue (label `harness-drift`) is not re-opened.
- For council refreshes: open a throwaway PR and confirm `council.yml` posts a verdict (the runner refuses an untracked plan / broken import).

## Out of scope

- The 6 divergent/non-inheritor councils (research-vault, abcs, pm-game, urban-explorer, ai-dev-team-template, and yolo's bespoke runner) — they don't consume `HARNESS_VERSION`; handled in audit steps 4 & 6.
- The 12 no-judgment-surface repos — no harness, nothing to reconcile.
