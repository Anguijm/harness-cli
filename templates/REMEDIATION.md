# Remediation Protocol

How the harness handles council failures and disputes.

## On FAIL
1. The plan is rejected. The CLI shows which expert(s) issued FAIL and why.
2. The human can: edit the feature description, add constraints, or override.
3. Re-run `harness plan` with the refined description.
4. Maximum 3 consecutive FAILs on the same feature → halt and suggest breaking it into smaller pieces.

## On WARN
1. The plan is approved with caveats.
2. WARN items are logged in the plan's "Out of Scope (Future)" section.
3. The coding agent should still implement the plan — WARNs don't block.

## On CLEAR
1. The plan is approved. Proceed to handoff.

## Dispute Resolution (Internal)
If the Lead Architect disagrees with an expert's FAIL:
1. Round 1: Architect explains why the finding is incorrect.
2. Round 2: Expert re-evaluates with the new context.
3. If still unresolved after 2 rounds: the FAIL stands and goes to the human.

## 3-Strike Circuit Breaker
If 3 consecutive `harness plan` runs FAIL on the same feature:
- The CLI halts and prints: "This feature has failed council 3 times. Consider breaking it into smaller pieces or re-evaluating the approach."
- Prevents infinite token burning on fundamentally flawed ideas.

## Severity Guide
| Severity | Examples | Response |
|----------|---------|----------|
| Critical | Auth bypass, data loss, injection | FAIL. No deferral. |
| High | Broken user flow, missing validation | FAIL or fix before coding. |
| Medium | Poor naming, missing edge case | WARN. Fix or defer. |
| Low | Style preference, minor optimization | CLEAR with note. |
