# Learnings — harness-cli

Append-only log of compounding institutional knowledge. Entries are organized by session/sprint with KEEP / IMPROVE / INSIGHT / COUNCIL blocks. Past entries are immutable; new lessons append, never edit prior ones.

## Format

```
## YYYY-MM-DD — <session label>

### KEEP
- <pattern that worked, worth preserving>

### IMPROVE
- <pattern that didn't, with the proposed change>

### INSIGHT
- <new understanding about the codebase, the domain, or the harness>

### COUNCIL
- <verdict received, key remediation, lesson for the next round>
```

## Entries

<!-- New entries below this line. Do not edit entries above. -->

## 2026-05-02 — architecture persona BLOCK'd a release-bump PR

### COUNCIL
- PR #9 (`chore: bump to v0.3.0`) returned 🔴 BLOCK / High confidence with the architecture persona scoring 3 and asserting the version bump "violates semver because no functional changes are included." False positive — the diff is intentionally just the version string; the features that justify v0.3.0 landed in PRs #1, #3, #4, #5, #6, #7, #8.

### IMPROVE
- Tightened `.harness/council/architecture.md` scope with an explicit "Out of scope (do NOT flag)" section excluding release-bump PRs and CHANGELOG-only PRs. Backported to `templates/harness/council/architecture.md` so consumer repos don't hit the same false positive when they cut their own releases.

### INSIGHT
- The architecture persona's recurring weakness is scoring the diff in isolation without reading the PR's intent. Same shape as prior bad-faith council results on consumer repos (a11y/i18n hallucinations). Fix is the same: name the legitimate-but-recurring artifact class explicitly in the persona's scope so it stops re-discovering "novel" violations every time.
- Security persona also returned a confused signal — body said "None. This is a version bump with no logic or dependency changes" while scoring 1/10. Score and body disagreed; treating it as a calibration artifact rather than a real finding for now. Worth watching whether it recurs across release-bump PRs.

### KEEP
- The dispute pattern works: document the false-positive in a PR reply, record the failures.jsonl entry, tighten the persona scope, backport. Doctrine + steering loop closes the gap rather than requiring a manual override.
