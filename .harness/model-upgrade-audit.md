# Model upgrade audit checklist

When swapping the LLM (e.g., gemini-2.5-pro → gemini-3-pro), audit every layer the model touches before merging.

## 1. Council runner

- `HARNESS_MODEL` env default (in `.harness/scripts/council.py`).
- `--model` flag default in `argparse`.
- The `setup-python` action uses `cache: pip` keyed on `requirements.txt` — bumping the SDK may invalidate the cache (acceptable, just expect first-run slowness).

## 2. SDK version

- `google-generativeai` version in `.harness/scripts/requirements.txt`. New models often require a minimum SDK version.
- Run `pip install --upgrade google-generativeai` locally and verify imports cleanly.

## 3. Persona compatibility

- Persona prompts assume a certain context-window size. New models may have different limits — check `CALL_CAP` and the per-call token budget.
- Output format compatibility: `extract_score()` parses `Score: <n>` lines. New models may produce different formatting; verify with one local council run before merge.

## 4. Cost recalibration

- Per-call price changes drive `MONTHLY_CAP` in `council.yml`. Update the cap if the new model is significantly cheaper or more expensive.
- Update the council comment text that explains the cap.

## 5. Drift retest

- Run the council on a known-good PR locally with the new model.
- Compare against the previous round's verdict — should not drift on factual questions.
- If drift is significant, hold the upgrade and investigate (likely persona prompt needs adjustment).

## Rollback

- `git revert` the SHA that bumped the model.
- The next council run picks up the old model from the reverted file.
- No config files outside the repo to update.
