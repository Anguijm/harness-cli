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

## 2026-04-30 — direct-push asymmetry on harness-cli

### IMPROVE
- Opening PRs for consumer repos (roadtripper / sportsdata / city-atlas) but direct-pushing to harness-cli main was an asymmetry I drifted into without realizing it. The canonical repo should especially follow canonical doctrine — "right thing should be the easy thing" cuts both directions.

### COUNCIL
- .github/workflows/branch-guard.yml caught it 7 times in a row between the V0.2.0 squash-merge and `5ae15d6` (harness lint). Signal was loud. Going forward, every harness-cli change goes through a PR. Operational alignment with the canonical CLAUDE.md doctrine.

### INSIGHT
- Sensors that fire post-hoc and repeatedly without changing behavior are louder signals of broken discipline than sensors that fire pre-emptively. branch-guard was working perfectly; the discipline was the gap.

