# Draft plan: continuous logprob scoring + repeated evaluation in the canonical council

> **Status: DRAFT for review.** Not yet promoted to `.harness/active_plan.md`. Derived from the verification-scaling audit (`docs/verification-scaling-audit.md`). Ships Techniques **T1 (continuous logprob scoring)** and **T2 (repeated evaluation K)** from Kwok et al. 2607.05391. Both behind config knobs defaulting to today's behavior — zero behavior change until opted in.

## Repository Impact

Grounded in the actual canonical runner, not guessed:

- **`.harness/scripts/council.py`**
  - `call_gemini()` (~L468): bare `client.models.generate_content(model, contents)` — **no `generation_config`**. This is where `response_logprobs` + top-`k` `logprobs` get requested.
  - `extract_score()` (~L486): scans prose for `Score:`, strips `/10`, `int(float(...))`. **This function is replaced** by an expectation over the scoring-token logit distribution: `R = Σ_g p(v_g)·φ(v_g)`.
  - `main()` reviewer loop (~L596–627): `ThreadPoolExecutor(max_workers ≤ 6)` runs each persona **once**. T2 wraps this in a K-repeat + average.
  - `RequestBudget` / `CALL_CAP = 20` (~L42, L433–450) and the pre-flight worst-case check (~L560–571): **K multiplies calls**, so the pre-flight math and cap accounting must be updated or K is a budget footgun.
- **`src/lib/personas.js`** / persona `Output format` blocks (e.g. `.harness/council/security.md` `Score: <1-10>`): the score line must emit a **single scoring token** on a fixed scale so the logprob read is clean (paper uses a 1–20 letter/single-token scale deliberately, *not* multi-digit integers).
- **`harness.yml`** `council.*`: add `granularity` and `repeat_k` (both default to today's behavior). Mirror any cap-affecting change into `.github/workflows/council.yml` (`MONTHLY_CAP` comment already flags this sync requirement).
- **`src/commands/*`**: no change — `research`/`recall`/`synthesize` don't touch the scoring path.
- **Downstream:** 6 canonical-inheritor repos pick this up via `HARNESS_VERSION` bump (see audit §Version drift — must be reconciled first).

## Research (persona concerns to address in the plan body)

- **Cost / budget** — K× and G× multiply token spend against `CALL_CAP=20` / `monthly_cap=60`. *Addressed:* both knobs default to G=1/K=1 (no change); pre-flight worst-case check updated to `personas × K × (retries+1)`; refuse to start if it exceeds the cap.
- **Backward compatibility** — a live PR-gating sensor must not change verdicts silently on upgrade. *Addressed:* default config reproduces today's discrete path bit-for-bit; logprob path is opt-in per repo.
- **Logprob availability** — not guaranteed on every SDK/model (legacy `google-generativeai` vs `google-genai`; `gemini-2.5-pro` vs `flash`). *Addressed:* detect logprob support at call time; **fall back to the existing `extract_score` prose parse** when absent. The fallback is NOT silent — the path used is reported per-persona (see below). (Full SDK-agnostic fix is Technique 6, tracked separately.)
- **Malformed / missing scoring token** (bugs persona, #11) — the logprob read assumes a clean single scoring token at the tagged position. If the model emits prose or an unexpected token, the read must **fail gracefully with a recorded reason**, not crash and not silently degrade to the prose parser as if nothing happened. *Addressed:* step 3 + step 7 below.
- **Outlier masking under K-repeat** (bugs persona, #11) — averaging K scores can hide a single catastrophic-but-valid run (e.g. one 1/20 among nine 19/20s) that variance alone may not make obvious. *Addressed:* report the full distribution (min/max/mean/variance), step 6.
- **Calibration honesty** — a continuous score is not automatically well-calibrated. *Addressed:* keep the discrete synthesis thresholds initially; treat the continuous score as an *added* signal + tie-breaker before rewiring any gate logic on top of it.
- **Determinism / reproducibility** — K-sampling introduces run-to-run variance in a gate. *Addressed:* fixed seed where the SDK allows; report the per-persona score variance in the council report so flakiness is visible.

## Plan

1. **Config knobs** (`harness.yml` + loader): `council.granularity` (int, default 1) and `council.repeat_k` (int, default 1). Validate ranges; document in the `council.*` block.
2. **Scoring token** (persona output format): change the `Score:` line to a single-token fixed-scale emission (letter-mapped 1–20) so a top-`G` logprob read is unambiguous. Keep the prose critique unchanged.
3. **`call_gemini` → `score_with_logprobs`**: when `granularity > 1` and the model/SDK supports it, request `response_logprobs` + `logprobs=G` at the score position, compute `R = Σ_g p(v_g)·φ(v_g)`, normalize to [0,1]. **Missing/malformed token handling:** if the expected scoring token is absent or unparseable at the tagged position, do NOT crash and do NOT silently fall back — record a structured reason (`malformed_score_token`) and return it alongside the fallback result. Fall back to `extract_score` only for genuine no-logprob-support cases. Return `(continuous_score, path_used, reason?)`.
4. **Repeated evaluation**: wrap the per-persona call in a K-repeat, keep every individual score, and compute the full distribution (min, max, mean, variance). Reuse the existing `ThreadPoolExecutor`; account every call against `RequestBudget`.
5. **Budget guard**: update the pre-flight worst-case check to `personas × K × (retries+1)`; hard-refuse if it exceeds `CALL_CAP`; surface the projected call count in the run header. (Note: confirm against the implementation whether retries nest inside or outside the K-loop; the guard must bound the true worst case either way.)
6. **Report** (`.harness/last_council.md`): add a `## Continuous scores` section that, per persona, shows the **full distribution (min / max / mean / variance)** across the K repeats AND **which scoring path was used** (`logprob` or `prose_fallback`, plus any `malformed_score_token` reason). This is a visible part of the PR comment, not just a log line — a degraded/fallback run must be obvious to the human reader. Synthesis logic unchanged in this PR.
7. **Tests**: unit-test the expectation math against a known logit distribution; test that the prose fallback fires (and is labelled) when logprobs are absent; test that a **malformed/missing scoring token** is reported with a reason rather than crashing or silently falling back; test the budget pre-flight refuses an over-cap `(personas, K)` combo.
8. **Backport**: land in `harness-cli`; the 6 canonical inheritors get it on their next `HARNESS_VERSION` bump (gated on the audit's version-drift cleanup).

**Out of scope for this PR:** rewiring the CLEAR/CONDITIONAL/BLOCK synthesis thresholds onto the continuous score; Technique 6 (two-stage split); Technique 5 (VOC); the divergent councils. Each is its own follow-up.
