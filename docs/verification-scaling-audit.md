# Verification-Scaling Applicability Audit

**Source paper:** *LLM-as-a-Verifier: A General-Purpose Verification Framework* (Kwok et al., arXiv:2607.05391v2)
**Scope:** all 25 repositories under `github.com/anguijm`
**Method:** read-only workflow-surface probe (GitHub API, no clones) + the seven-question applicability rubric below
**Date:** 2026-07-08

---

## TL;DR

The paper's central move — stop collapsing an LLM judge into a discrete verdict; read the **logprobs over the scoring tokens** for a continuous, calibrated score, then scale it with **repeated evaluation (K)** and **criteria decomposition (C)** — lands directly on the one thing this ecosystem has a lot of: **Gemini/Claude councils that emit discrete verdicts.**

The decisive finding is structural, not per-repo:

> **7 of the 25 repos share one canonical `council.py` lineage.** Land the upgrade **once** in `harness-cli` and it flows to all of them through the existing **backport rule** + a `HARNESS_VERSION` bump. Do **not** hand-patch 25 repos.

The work therefore splits into exactly three tracks:

1. **One canonical upgrade** in `harness-cli` → inherited by 6 downstream canonical repos.
2. **A version-drift cleanup** that is the precondition for #1's "free" inheritance (inheritors are scattered across V0.2.1 / V0.3.0 / V0.3.1 / no-pin).
3. **A handful of bespoke applications** for the divergent councils that don't inherit.

12 repos have **no LLM judgment surface at all** — the framework does not apply and they need no work.

---

## The applicability rubric (the reusable method)

A "workflow" that the paper can improve is any workflow with a **judgment/decision point**. That surface lives in four layers — CI YAML (`.github/workflows/`), inferential sensors (`.harness/scripts/council.py`), CLI verb pipelines (`src/commands/`), and hooks (`.claude/hooks/`) — so an audit that reads only the YAML misses most of it.

For each workflow, ask in order (Q1 is the filter; Q2–Q7 each map to one paper technique):

| # | Question | Technique it unlocks |
|---|---|---|
| 1 | Is there a judgment/decision point at all? | *filter — if no, stop* |
| 2 | Does it collapse a rich signal into a discrete label? | **T1** continuous logprob scoring |
| 3 | Is the decision single-shot / noisy? | **T2** repeated evaluation (K) |
| 4 | Is the criterion monolithic? | **T3** criteria decomposition |
| 5 | Does it choose among multiple candidates? | **T4** probabilistic pivot tournament + A/B bias-swap |
| 6 | Is it long-running / autonomous? | **T5** VOC progress-tracking / early-halt |
| 7 | Does the model expose logprobs? | **T6** two-stage reasoning/scoring split |

Then score each hit **value × effort** so the output is a ranked backlog, not a flat list.

---

## Full classification (all 25 repos)

### Category A — Canonical source (1)

| Repo | Council | Notes |
|---|---|---|
| **harness-cli** | `google-genai`, `gemini-2.5-pro`, prose `Score:1–10` → discrete `🟢/🟡/🔴` synthesis; no logprobs. Also a JS `council.js` (Claude, `SCORE:/10`) for `plan`/`review`. | **The place to land the fix.** Everything downstream inherits from here. |

### Category B — Canonical inheritors (6) — *fix once upstream, they inherit*

| Repo | Version pin | SDK | Specialization | Applicable |
|---|---|---|---|---|
| **sportsdata** | V0.2.1 | google-genai | data-quality / statistical-validity / prediction-accuracy / domain-expert | T1,T2,T3,T6 (+ T5 on cron) |
| **presentation** | V0.2.1 | google-genai | factual-accuracy / strategic-comms / presentation-design / pptx-rendering / code-craft | T1,T2,T3,T6 |
| **city-atlas-service** | V0.2.1 | google-genai | *uninitialized* (`{{PROJECT_NAME}}` placeholders) | T1,T2,T3,T6 |
| **roadtripper** | V0.2.1 | google-genai | filesystem personas; most advanced (cross-round drift-prevention) | T1,T2,T3,T6 |
| **llmwiki-nodep** | **V0.3.0 + SHA** | *legacy* google-generativeai | canonical 7 | T1,T2,T3,**T6** |
| **llmwiki_studygroup** | **no pin (detached)** | *legacy* google-generativeai | canonical 7 + Claude Haiku PR-watcher | T1,T2,T3,T6 |

### Category C — Divergent councils (6) — *bespoke application each*

| Repo | Judgment surface | Applicable |
|---|---|---|
| **yolo-projects** | bespoke `council.py`: legacy SDK, `gemini-2.5-flash`, JSON `APPROVE/OBJECT` + severity + **lessons veto** + 4 auto-downgrade passes + 2-attempt deadlock | T1,T2,T3, **T5** (hourly tick-tock self-commits to `main`), A/B swap on deadlock |
| **research-vault** | `verify_facts.py` (Claude, `SUPPORTS/PARTIAL/DOES_NOT_SUPPORT`) + `red_team.py` (Gemini 3.1-pro, severity → `ship-ready/iterate/rebuild`) | T1,T2,T3,T6 — documented false-negative from source truncation → **T2 directly helps** |
| **abcs** | bespoke Claude critic council (variety/compliance/pedagogy/brand), numeric **threshold-8** gate, generative pipeline | **T4 (best-of-N — standout fit)**, T1,T2,T3,T6, latent T5 |
| **pm-game** | `gemini-audit.yml`: single `curl` to `gemini-2.5-flash`, monolithic prompt, `VERDICT: FAIL/WARN/CLEAR` | T1,T2,T3,T6 |
| **urban-explorer** | **byte-identical** `gemini-audit.yml` (shares SHA with pm-game) + Claude Code Review | T1,T2,T3,T6 |
| **ai-dev-team-template** | ancestor `gemini-audit.yml` (`FAIL/WARN/CLEAR`); **archived** | T1,T2,T3,T6 (low priority — archived) |

### Category D — No judgment surface (12) — *framework does not apply*

`llm-wiki-hub`, `lucky-leaf`, `policies`, `brain-garden`, `wickbearers`, `tactical-card-espionage`, `origin`, `mission-control`, `intermediate-python-course`, `server`, `project1` — no LLM gate/judge/council.

**`brain`** is a special case: it *has* LLM code (`expand.py`, Anthropic) but selection is deterministic (source-tier sort) and the promotion gate is human. **Latent** fit only — T4 (best-of-N source ranking) and T1/T3 at the promotion gate *if* an LLM judge is ever added.

---

## Cross-cutting findings

**1. The backport rule is the whole strategy.** harness-cli + 6 inheritors = 7 repos upgraded by one canonical change. This is the difference between a one-PR project and a 25-PR project.

**2. Version drift blocks the free inheritance.** The inheritors are pinned at **four different states**: V0.2.1 (×4), V0.3.0+SHA (×1), V0.3.1 (yolo), and **no pin at all** (llmwiki_studygroup is a detached copy that will *not* inherit via version bump). Closing this gap is the precondition for #1 paying off — otherwise the fix lands upstream and reaches nobody. `city-atlas-service` additionally still has template placeholders in `harness.yml`.

**3. The SDK split fragments Technique 1.** Inheritors are split between the new `google-genai` SDK and the legacy `google-generativeai` SDK; logprob access differs by SDK/model path. **Technique 6 (two-stage reasoning/scoring split) is the universal fallback** — it works regardless of SDK or whether the reasoning model exposes logprobs, by routing reasoning through any model and reading logprobs from a Gemini Flash scoring pass. This makes T6 the safest thing to standardize.

**4. Divergent councils cluster.** pm-game + urban-explorer + ai-dev-team-template share one `gemini-audit.yml` — a single bespoke fix backports to all three. research-vault and abcs are genuinely one-off.

**5. Technique 4 (best-of-N) barely applies.** Only **abcs** (generative episode pipeline) is a natural fit today; **brain** is latent. Every other council is a *merge gate*, not a candidate selector — asking "which of N is best?" isn't the question they answer.

**6. Technique 5 (VOC progress-monitoring) fits exactly 2 repos.** The autonomous self-committing pipelines: **yolo-projects** (hourly tick-tock → `main`) and **sportsdata** (twice-daily predict + 45-min backfill + 30-min ratchet). Everywhere else the "cron" is just a read-only weekly `drift-check.yml` — no long autonomous run to monitor.

---

## Recommended rollout (priority order)

1. **Land T1 + T2 in canonical `harness-cli` council** behind config knobs (`council.granularity`, `council.repeat_k`) that **default to today's behavior** (G=1, K=1) — zero behavior change until opted in. Draft plan attached. *Unblocks 7 repos.*
2. **Version-drift cleanup**: bump the 4 V0.2.1 inheritors + llmwiki-nodep to the new canonical tag; give **llmwiki_studygroup** a `harness.yml` + `drift-check.yml` pin so it stops being a detached copy; initialize `city-atlas-service`'s `harness.yml`. *This is what makes step 1 actually propagate.*
3. **T6 (two-stage split) as the second canonical feature** — the SDK-agnostic path; especially unblocks the legacy-SDK repos.
4. **yolo-projects**: apply T1 to replace the 4 keyword-heuristic auto-downgrade passes with calibrated thresholds; add **T5 VOC monitoring** to tick-tock so a stalling run halts before committing broken state to `main`.
5. **sportsdata**: T5 on the long backfill/ratchet runs.
6. **Bespoke divergent councils**: one shared fix for the `gemini-audit.yml` trio (T1/T3); research-vault (T2 fixes a known false-negative); abcs (T4 best-of-N).
7. **Skip**: Category D (12 repos), and the RL / robotics half of the paper entirely (no policy training anywhere in the ecosystem).

---

## What does *not* transfer

The paper's second half — dense reward for RL (DSRL-SAC, GRPO), robotics/VLM reward models, sample-efficiency results — has **no surface** in this ecosystem. None of these repos train a policy. Only the verification-as-test-time-scaling half (T1–T6) applies.
