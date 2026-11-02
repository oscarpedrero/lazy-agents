# lazy-agents

Load your Claude Code subagents on demand instead of on every request.

Claude Code puts the description of every custom subagent into the Agent tool listing at session start, and every subagent you launch pays for that listing again. With a large agent collection (170 agents in the author's setup) that is about 14k tokens per session and per subagent, most of it for agents you never use.

`lazy-agents` does for subagents what Tool Search does for MCP tools: the agents stay installed, but the model only sees the ones it needs.

## How it works

1. **Hide.** An `agent.offer` hook keeps the agents defined in `~/.claude/agents/` out of the listing. Built-in agents, plugin agents, project agents (`.claude/agents/` in a repository) and a short pinned list stay visible.
2. **Find.** The mod registers one tool, `find_agent(query)`. It searches the hidden agents by name and description and returns the best matches.
3. **Unlock.** Every match is unlocked for the rest of the session. The engine announces it as a listing delta, so the prompt cache is kept.
4. **Run.** Claude launches the unlocked agent with the native Agent tool, so nothing is lost: the agent's own `tools`, `model` and prompt apply, and worktree isolation, background runs, teams and SendMessage work as usual.

If a hook fails, the engine shows the agent anyway: the worst case is the behaviour you have without the mod.

## What it can access

- Reads the `HOME` environment variable and the `.md` files under `~/.claude/agents/` (up to 6 folders deep and 1000 files; symbolic links are not followed).
- Registers one tool, `find_agent`, and hooks `session.start`, `agent.offer` and calls to its own tool.
- No network, no processes, no file writes, no dependencies.
- It can only hide an agent: unlocking hands the decision back to Claude Code, so it never offers an agent Claude Code would refuse.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install lazy-agents --marketplace oscarpedrero/lazy-agents
```

Answer `y` to add the marketplace, then pick a scope (user scope applies it to every session).

From a shell:

```
claude plugin install lazy-agents --marketplace oscarpedrero/lazy-agents
```

Start a new session afterwards: the agent listing is built when a session starts.

## Configure

Pinned agents are always listed. Edit `PINNED` in `hooks/register.ts` to keep the agents you use every day out of the lazy set:

```ts
const PINNED = new Set(['review-risk', 'jd-judge-a' /* ... */])
```

Only agents whose source is your user settings (`~/.claude/agents/`) are hidden.

## Measured

Two fresh `claude -p` sessions with the same 170 user agents, comparing the agent listing the model actually receives (the `agent_listing_delta` row in the session transcript):

| | Without the mod | With the mod |
|---|---|---|
| Agent listing | 95.4 KB | 8.4 KB |

## Caveats

- `/context` estimates "Custom agents" from the agent files on disk and does not ask the `agent.offer` hook, so it keeps showing the full figure. Check the session transcript to see what the model receives.
- Agent files added or restored while a session runs are picked up by the engine only in a new session.
- The unlocked set lives in the session; a new session starts with every user agent hidden again.

## Development

```
claude plugin validate .
claude plugin test .
```

## License

MIT
