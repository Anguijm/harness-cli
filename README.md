# harness-cli

AI development harness — your engineering manager in a CLI. Plans features, runs them through an expert council, resolves conflicts, and hands a bulletproof spec to your coding tool.

## What It Does

You describe a feature. Three AI experts argue about it. A lead architect resolves their conflicts. You approve the plan. Then your coding tool (Aider, Claude Code, Cursor) executes it.

```
harness plan "Add Stripe webhook handling for payment events"

  Council convening...
    security:       8/10 (3.2s)
    architecture:   7/10 (2.8s)
    product:        9/10 (2.1s)

  Lead Architect resolving...
  Plan generated.

  Council Scores:
    security        8/10
    architecture    7/10
    product         9/10
    average         8.0/10

  Accept plan? [Y/n/edit] Y

  Plan approved. Handoff ready.

  To execute with Aider:
  aider --message-file .harness/aider-instructions.txt

  To execute with Claude Code:
  claude "Read .harness/plan.md and implement it exactly."
```

## Install

```bash
npm install -g harness-cli
```

Requires `ANTHROPIC_API_KEY` environment variable.

## Quick Start

```bash
cd my-project
harness init                                    # creates harness.yml + .harness/
harness plan "add user auth with JWT"           # council debates, generates plan
aider --message-file .harness/aider-instructions.txt  # execute the plan
```

## Commands

| Command | Description |
|---------|-------------|
| `harness init` | Initialize harness in current project |
| `harness plan "feature"` | Run council, generate plan, create handoff |
| `harness review` | Run council on existing code (v0.2) |
| `harness status` | Show session history and memory (v0.2) |

## How It Works

### The Council

Three expert personas review your feature request in parallel:

- **Security** — vulnerabilities, auth flaws, injection risks, data exposure
- **Architecture** — data model, API design, component boundaries, scalability
- **Product** — user impact, UX issues, scope, accessibility, mobile

### The Resolver

A Lead Architect reads all three critiques, resolves contradictions, and writes a single coherent plan with:
- Architecture decisions
- Implementation steps (ordered, testable)
- Security requirements (non-negotiable)
- Edge cases
- Out-of-scope items

### The Circuit Breaker

The CLI pauses and shows you the plan. You approve, reject, or edit before any code is written. No autonomous coding without human sign-off.

### The Handoff

Generates `.harness/aider-instructions.txt` — a complete implementation spec that any coding tool can execute. Also saves to `.harness/plan.md` for reference.

## Configuration (harness.yml)

```yaml
name: my-project
stack: node
framework: express
language: typescript

council:
  angles:
    - security
    - architecture
    - product
  model: claude-sonnet-4-6

commands:
  test: npm test
  build: npm run build
```

## Custom Council Angles

Add custom expert personas by dropping markdown files in `.harness/council/`:

```bash
# .harness/council/accessibility.md
You are an Accessibility Expert reviewing a development plan...
```

Then run with: `harness plan "feature" --council security architecture accessibility`

## Memory

The harness remembers past decisions in `.harness/memory/`. Each plan session is logged with council scores, timestamps, and the feature description. This context is injected into future council sessions so experts build on past architectural choices.

## Use as Claude Code Hook

Add to your Claude Code config to run the council automatically:

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Edit|Write",
      "command": "harness plan \"$DESCRIPTION\" --no-interactive > /dev/null"
    }]
  }
}
```

## Use in CI/CD

```yaml
# .github/workflows/harness.yml
- run: harness plan "${{ github.event.issue.title }}" --no-interactive
- run: aider --message-file .harness/aider-instructions.txt --yes
```

## Philosophy

- **Think before you type.** The harness does the reasoning. Your coding tool does the typing.
- **Multiple perspectives.** One reviewer misses things. Three experts catch what each other misses.
- **Human in the loop.** No autonomous coding without approval. The circuit breaker is sacred.
- **Tool agnostic.** Works with Aider, Claude Code, Cursor, or any tool that reads text.
- **Methodology as code.** The council personas, the pipeline, the memory — all version-controlled in your repo.

## Roadmap

- **v0.1** (current): Plan command with council + resolver + handoff
- **v0.2**: Review command (council on existing code), status command, tick-tock cadence
- **v0.3**: Claude Code hooks adapter, GitHub Actions integration
- **v0.4**: Phase 4 experiment pipeline (YouTube RSS → backlog)
