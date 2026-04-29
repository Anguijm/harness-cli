---
name: close-session
description: Use this skill when the user says "close the session", "wrap up", "we're done for today", "let's close out", or similar. Performs the full session-closeout ritual so the next session starts clean.
---

# Close session

When the user invokes this, do the full closeout. The goal: the next session can pick up cold without context.

## Closeout checklist (run in order)

1. **Check for uncommitted changes.**
   - `git status --short`
   - If anything is uncommitted: ask whether to commit, stash, or discard. Default to committing.
   - Show the user a one-sentence summary of what's about to commit before doing it.

2. **Check the branch is pushed.**
   - `git log @{u}..HEAD` — any local commits not in upstream?
   - If yes: push to the configured branch (per CLAUDE.md / system instructions).
   - If no upstream is set: push with `-u` to the development branch.

3. **Refresh `.harness/active_plan.md`.**
   - If the plan describes work that was completed this session, mark it done or replace with the next-session pickup.
   - If the plan describes work still in progress, add a "where we left off" block at the top.

4. **Append to `.harness/learnings.md`.**
   - Add a session entry with KEEP / IMPROVE / INSIGHT / COUNCIL blocks.
   - One-line entries are fine — but each must be a learning, not a status update.
   - Do NOT edit prior entries; append-only.

5. **Update `README.md` if user-facing surface changed.**
   - New commands, new env vars, new setup steps → update README.
   - If nothing user-visible changed, skip.

6. **Update `SESSION_HANDOFF.md` (if the repo has one).**
   - Replace contents with: current branch, last commit, next-session pickup, any blockers.
   - This is regenerated each session, not append-only.

7. **Verify branch state.**
   - `git status --porcelain` should be empty.
   - `git log @{u}..HEAD` should be empty (everything pushed).

8. **Final summary to the user.**
   - One paragraph. What got done this session, what's next, where to resume.
   - Skip technical details unless they specifically matter for the next pickup.

## When closeout fails

If something blocks closeout (uncommitted changes the user doesn't want to commit, push fails, etc.), STOP and tell the user in plain language. Don't force-push, don't discard, don't bypass.

## Output style

Plain language. Don't show the user the git commands you're running unless they ask. Just say "committing your changes", "pushing", "updating the handoff doc", etc. Surface a diff or a file only if the user asks for it.
