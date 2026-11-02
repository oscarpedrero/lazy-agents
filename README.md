# lazy-agents

Load your Claude Code subagents on demand instead of on every request.

Claude Code puts the description of every custom subagent into the Agent tool listing at session start, and every subagent you launch pays for that listing again. With a large agent collection (170 agents in the author's setup) that is about 14k tokens per session and per subagent, most of it for agents you never use.

`lazy-agents` does for subagents what Tool Search does for MCP tools: the agents stay installed, but the model only sees the ones it needs.

## How it works

1. **Hide.** An `agent.offer` hook keeps the agents defined in `~/.claude/agents/` out of the listing. Built-in agents, plugin agents, project agents (`.claude/agents/` in a repository) and a short pinned list stay visible.
2. **Name.** The mod registers one tool, `find_agent`, whose description lists the hidden agents by name only (about 1k tokens for 170 agents instead of about 14k with descriptions).
3. **Dispatch.** When a name fits, Claude calls the native Agent tool with it directly. A hook unlocks that agent just before Claude Code checks it, so there is no extra turn. When the name is not enough, `find_agent(query)` searches the descriptions and unlocks the matches. Unlocked agents are announced as a listing delta, so the prompt cache is kept.
4. **Run.** The agent runs through the native Agent tool, so nothing is lost: its own `tools`, `model` and prompt apply, and worktree isolation, background runs, teams and SendMessage work as usual.

If a hook fails, the engine shows the agent anyway: the worst case is the behaviour you have without the mod.

## What it can access

- Reads the `HOME` environment variable and the `.md` files under `~/.claude/agents/` (up to 6 folders deep and 1000 files; symbolic links are not followed).
- Registers one tool, `find_agent`, and hooks `session.start`, `agent.offer`, calls to its own tool and calls to the Agent tool (only to unlock the agent it names; the call itself is passed on unchanged).
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

Cost per task with `claude -p` (Claude Opus 5.5) and the same 170 user agents, comparing no mod, 0.1 (search first) and 0.2 (names plus direct dispatch). Three alternating rounds per task, run in the same time window; the mod was turned off with `--settings '{"enabledPlugins":{"lazy-agents@lazy-agents":false}}'`.

| Task | No mod | 0.1 | 0.2 |
|---|---|---|---|
| Delegate to a hidden agent (SEO review of a small page) | $0.608 | $0.500 (−18%) | $0.480 (−21%) |
| Parent turns | 2-3 | 3-4 | 2 |
| Session that delegates nothing (read one line of a file) | $0.328 | $0.210 (−36%) | $0.211 (−36%) |

- Every run picked the same agent (SEO Specialist, 9 of 9 with each version). Asked to list its tools, the agent reported exactly its frontmatter set.
- The saving is mostly cache writes: the agent listing is written to the prompt cache again in every session and every subagent, at the cache-write price. Hiding it cuts about 14k cache-write tokens per session.
- 0.2 adds about 3k cache-read tokens per turn for the names, and removes the `find_agent` turn when Claude dispatches by name.
- The first session after the tool list changes (installing, updating or removing the mod) writes the whole prompt to the cache once and costs more; the figures above are warm.
- The agent listing the model receives (the `agent_listing_delta` row in the transcript) drops from 95.4 KB to 8.4 KB.

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
