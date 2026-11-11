# automation

Shared GitHub Actions workflows for BoardGamesEmpire repositories.

## Bug agent

When someone with write access labels an issue `bug`, an agent triages it and
ends in one of the triage labels, with one comment on the issue saying why:

- `needs-info`: the agent can't tell what's wrong from the issue, and lists
  what it needs.
- `ready-for-human`: it isn't a bug, the fix needs a decision, or the fix is
  outside the repository's limits.
- `ready-for-agent`: the cause is clear and the fix is small and local. The
  agent writes a failing test and the fix, verifies them, and a draft pull
  request follows with `Closes #<issue>`.

It never applies `wontfix`, and it never merges. Any failure or timeout ends
in `ready-for-human` with the reason.

The workflow checks the sender's permission itself, so an issue template that
applies `bug` is safe: a report from someone who can't push starts nothing,
and the issue stays as filed.

[`.github/workflows/bug-agent.yml`](.github/workflows/bug-agent.yml) explains
the four jobs and why the agent never holds a token that can write.
[`bug-agent/`](bug-agent) holds the prompts and the publish script, which the
workflow always reads from this repository's `master`.

### Calling it

A repository adds a caller workflow and a setup action.

```yaml
# .github/workflows/bug-agent.yml
name: Bug agent

on:
  issues:
    types: [labeled]

permissions:
  contents: read
  issues: read
  id-token: write

concurrency:
  group: bug-agent-${{ github.event.issue.number }}
  cancel-in-progress: false

jobs:
  bug-agent:
    if: github.event.label.name == 'bug' && github.event.sender.type == 'User'
    uses: BoardGamesEmpire/automation/.github/workflows/bug-agent.yml@master
    with:
      bge-agent-client-id: ${{ vars.BGE_AGENT_CLIENT_ID }}
      fix-tools: 'Bash(npm test:*)'
      protected-paths: |
        package.json
      test-paths: |
        *.test.ts
      notes: |
        Verify with `npm test`.
    secrets:
      bge-agent-private-key: ${{ secrets.BGE_AGENT_PRIVATE_KEY }}
      anthropic-api-key: ${{ secrets.BGE_AGENT_ANTHROPIC_API_KEY }}
```

Call it at `@master`, unpinned: the prompts and scripts come from `master`
whatever ref the caller names, so a pin wouldn't freeze them, and workload
identity federation, when it returns, trusts `job_workflow_ref` on `master`
only.

`.github/actions/bug-agent-setup/action.yml` is a composite action that
installs what verifying a fix needs. It must restore caches without saving
them: the job runs code the agent wrote, and an issue-triggered job saves into
the default branch's cache scope, which that branch's CI restores. Whatever it
writes must be gitignored, or it lands in the fix.

| Input             | Meaning                                                                        |
| ----------------- | ------------------------------------------------------------------------------ |
| `fix-tools`       | Claude Code tool rules, comma-separated, for the verify commands               |
| `protected-paths` | Shell globs a fix may not change; `.github/*` is always protected              |
| `test-paths`      | Shell globs of test files, which don't count toward the line limit             |
| `module-pattern`  | Bash regex whose first group names a path's module; at most one module per fix |
| `max-lines`       | Most changed lines outside tests (default 100)                                 |
| `notes`           | Where the repository's agent instructions live, and the verify commands        |

### One-time setup

**GitHub App** (`bge-agent`): read and write on Contents, Issues and Pull
requests, installed on each calling repository. Its client ID goes in the
`BGE_AGENT_CLIENT_ID` variable and its private key in the
`BGE_AGENT_PRIVATE_KEY` secret, at organization level so every caller shares
them.

**Claude API key**: create a key in a workspace with a spend limit and store
it in the organization secret `BGE_AGENT_ANTHROPIC_API_KEY`, limited to the
calling repositories. The agent runs through the Claude Agent SDK
(`bug-agent/run-agent.mjs`), which keeps the key out of the agent's commands
by running them under bubblewrap.

Not `anthropics/claude-code-action`, and not workload identity federation for
now. The action marks every request as the Claude Code GitHub Action, which
promotional credit doesn't cover: the same key and prompt succeed without
that mark and fail with "Credit balance is too low" with it
(BoardGamesEmpire/board-games-empire-backend#1192). Federation came with the
action, so it waits until the runner supports it; the workflow still accepts
the `anthropic-federation-*` inputs and ignores them.
