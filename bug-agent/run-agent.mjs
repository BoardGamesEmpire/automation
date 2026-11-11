// Runs one bug agent job (triage or fix) through the Claude Agent SDK and
// writes the agent's decision to the step's `structured_output` output.
//
// The SDK, not anthropics/claude-code-action: the action marks every request
// as coming from the Claude Code GitHub Action, which promotional credit
// doesn't cover, while the Agent SDK is a covered service
// (BoardGamesEmpire/board-games-empire-backend#1192).
//
// Environment:
//   ANTHROPIC_API_KEY    the Claude API key
//   PROMPT_FILE          the prompt, as bug-agent/prompt.sh printed it
//   AGENT_MODEL          model id
//   AGENT_EFFORT         reasoning effort
//   AGENT_MAX_TURNS      turn limit
//   AGENT_ALLOWED_TOOLS  comma-separated Claude Code tool rules
//   AGENT_SCHEMA         JSON schema the decision must match
//   GITHUB_OUTPUT        set by Actions
//
// The log shows only which tools ran and the run's totals, never what the
// agent read or wrote: the calling repositories are public, and a tool
// result could hold anything.
import { appendFileSync, readFileSync } from 'node:fs';
import { query } from '@anthropic-ai/claude-agent-sdk';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.log(`::error::${name} is not set`);
    process.exit(1);
  }
  return value;
}

const prompt = readFileSync(required('PROMPT_FILE'), 'utf8');
const allowedTools = required('AGENT_ALLOWED_TOOLS')
  .split(',')
  .map((rule) => rule.trim())
  .filter(Boolean);
required('ANTHROPIC_API_KEY');

// An error's text is the API's or the SDK's message, not anything the agent
// wrote, so it is safe to print.
function fail(detail) {
  const line = String(detail)
    .split('\n')
    .filter((l) => l.trim() && l.length < 300)
    .join(' ');
  console.log(`::error title=Claude API::${line.slice(0, 500)}`);
  process.exit(1);
}

let result;
try {
  for await (const message of query({
    prompt,
    options: {
      model: required('AGENT_MODEL'),
      effort: required('AGENT_EFFORT'),
      maxTurns: Number(required('AGENT_MAX_TURNS')),
      // Only the rules listed run; anything else is denied, not asked about,
      // since nobody is there to answer.
      allowedTools,
      permissionMode: 'dontAsk',
      outputFormat: { type: 'json_schema', schema: JSON.parse(required('AGENT_SCHEMA')) },
      // Claude Code's own system prompt, as the action used.
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      // No settings from the checked-out repository: its .claude/settings.json
      // could allow tools or run hooks beyond the rules above. The prompt
      // points the agent at the repository's instructions instead.
      settingSources: [],
      env: {
        ...process.env,
        CLAUDE_AGENT_SDK_CLIENT_APP: 'bge-bug-agent/1.0.0',
        // Keeps the API key out of the commands the agent runs.
        CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1',
      },
    },
  })) {
    if (message.type === 'assistant') {
      for (const block of message.message.content) {
        if (block.type === 'tool_use') console.log(`tool: ${block.name}`);
      }
    } else if (message.type === 'result') {
      result = message;
    }
  }
} catch (error) {
  // The SDK throws, rather than yielding a result, when the API turns the
  // run down or Claude Code can't start.
  fail(error?.message ?? error);
}

if (!result) fail('the run ended without a result');

console.log(
  `subtype: ${result.subtype}, turns: ${result.num_turns}, ` +
    `cost: $${result.total_cost_usd.toFixed(4)}, ${Math.round(result.duration_ms / 1000)}s`,
);

if (result.is_error || result.structured_output === undefined) {
  fail(
    (typeof result.result === 'string' && result.is_error && result.result) ||
      result.errors?.join('; ') ||
      `no structured output (${result.subtype})`,
  );
}

// One line: JSON.stringify escapes any newline inside the decision.
appendFileSync(
  required('GITHUB_OUTPUT'),
  `structured_output=${JSON.stringify(result.structured_output)}\n`,
);
