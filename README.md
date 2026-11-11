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
      anthropic-federation-rule-id: ${{ vars.ANTHROPIC_FEDERATION_RULE_ID }}
      anthropic-organization-id: ${{ vars.ANTHROPIC_ORGANIZATION_ID }}
      anthropic-service-account-id: ${{ vars.ANTHROPIC_SERVICE_ACCOUNT_ID }}
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

Call it at `@master`: the federation rule matches `job_workflow_ref` on
`master`, so a caller pinned to a tag or SHA can't get a Claude API token.

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

**Claude API**, through workload identity federation, so no API key is stored.
In the Claude Console, under Settings → Workload identity, register GitHub
Actions as an issuer (`https://token.actions.githubusercontent.com`,
discovery), create a service account in a workspace with a spend limit, and
create a rule targeting it with audience `https://api.anthropic.com`, scope
`workspace:developer` and this condition:

```text
claims.repository_owner_id == "150589533"
&& claims.repository_id in ["1127575497"]
&& claims.event_name == "issues"
&& claims.ref.startsWith("refs/heads/")
&& claims.job_workflow_ref == "BoardGamesEmpire/automation/.github/workflows/bug-agent.yml@refs/heads/master"
```

Each repository that calls the workflow needs its id in the
`repository_id` list (`gh api repos/<owner>/<repo> --jq .id`). The rule's,
organization's and service account's ids go in the
`ANTHROPIC_FEDERATION_RULE_ID`, `ANTHROPIC_ORGANIZATION_ID` and
`ANTHROPIC_SERVICE_ACCOUNT_ID` variables. They identify, they don't
authenticate, so they aren't secrets.

**Claude API key, while promotional credit is in use.** Promotional credit
pays for requests made with an API key but not for the federated service
account's, which the API turns down with "Credit balance is too low"
(BoardGamesEmpire/board-games-empire-backend#1192). Until that changes,
create a key in the same workspace and store it in the organization secret
`BGE_AGENT_ANTHROPIC_API_KEY`, limited to the calling repositories. A caller
passes it as `anthropic-api-key`, and the workflow then uses the key instead
of federation. Deleting the secret switches back to federation with no code
change.
