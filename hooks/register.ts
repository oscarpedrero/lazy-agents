import type { EngineInterface, Register } from 'claude-code'

// Agents defined in ~/.claude/agents are hidden from the Agent tool listing
// unless pinned here. The model discovers them with find_agent, which unlocks
// the matches so the native Agent tool can dispatch them with every option
// (worktree isolation, background, teams, SendMessage) intact.
const PINNED = new Set([
  'review-readability',
  'review-refuter',
  'review-reliability',
  'review-resilience',
  'review-risk',
  'jd-fix-agent',
  'jd-judge-a',
  'jd-judge-b',
])

const HIDDEN_SOURCES = new Set(['userSettings', 'user'])
const MAX_RESULTS = 8

type Entry = { agent: string; description: string }

const catalog = new Map<string, Entry>()
const unlocked = new Set<string>()

const isLazy = (agent: string, source: string) =>
  HIDDEN_SOURCES.has(source) && !PINNED.has(agent)

const field = (frontmatter: string, key: string) => {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))
  return match?.[1]?.trim().replace(/^["']|["']$/g, '')
}

// The engine fills the catalog through agent.offer only when it builds the
// listing. Reading the agent files too keeps find_agent useful before that.
let scannedDisk = false

const scanDisk = async ($: EngineInterface) => {
  if (scannedDisk) return
  scannedDisk = true

  const home = await $.env.get('HOME')
  if (!home) return

  const walk = async (dir: string): Promise<void> => {
    const entries = await $.fs.list(dir).catch(() => [])

    for (const entry of entries as { name: string; kind: string }[]) {
      const path = `${dir}/${entry.name}`

      if (entry.kind === 'dir') {
        await walk(path)
        continue
      }
      if (entry.kind !== 'file' || !entry.name.endsWith('.md')) continue

      const text: string = await $.fs.read(path).catch(() => '')
      const frontmatter = text.match(/^---\n([\s\S]*?)\n---/)?.[1]
      if (!frontmatter) continue

      const agent = field(frontmatter, 'name')
      const description = field(frontmatter, 'description')
      if (!agent || !description || PINNED.has(agent) || catalog.has(agent)) continue

      catalog.set(agent, { agent, description })
    }
  }

  await walk(`${home}/.claude/agents`)
}

const score = (entry: Entry, terms: string[]) => {
  const name = entry.agent.toLowerCase()
  const text = `${name} ${entry.description.toLowerCase()}`

  return terms.reduce((total, term) => {
    // Match at word starts, so "search" does not hit "research".
    const word = new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
    return total + (word.test(name) ? 3 : 0) + (word.test(text) ? 1 : 0)
  }, 0)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'find_agent',
      description:
        'Search the catalog of specialist subagents that are hidden from the Agent tool listing ' +
        '(marketing, sales, game engines, XR, compliance, writing, and more). ' +
        'Use it before delegating when no listed agent fits the task. ' +
        'Matching agents are unlocked for this session: then call the Agent tool with the returned ' +
        'subagent_type, using any Agent option as usual.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Keywords describing the specialist needed, e.g. "godot shader" or "seo".',
          },
        },
        required: ['query'],
      },
      isDeferred: false,
    })

    return next(e)
  })

  on('agent.offer', ($, e, next) => {
    if (!isLazy(e.agent, e.source)) return next(e)

    catalog.set(e.agent, { agent: e.agent, description: e.description })

    return unlocked.has(e.agent) ? next(e) : { isOffered: false }
  }).catch(($, e, next) => next(e)) // fail open: a broken hook never hides an agent

  on('tool.call', { tool: 'mcp__lazy-agents__find_agent' }, async ($, e) => {
    // The disk scan only adds to the catalog: its failure must not cost the search.
    await scanDisk($).catch(() => undefined)

    const query = String((e as { query?: unknown }).query ?? '').toLowerCase()
    const terms = query.split(/\s+/).filter(term => term.length > 1)

    if (catalog.size === 0) {
      return { result: 'The hidden-agent catalog is empty: no user agents were offered yet this session.' }
    }

    const matches = [...catalog.values()]
      .map(entry => ({ entry, points: score(entry, terms) }))
      .filter(match => match.points > 0)
      .sort((a, b) => b.points - a.points)
      .slice(0, MAX_RESULTS)

    if (matches.length === 0) {
      return {
        result: `No hidden agent matches "${query}". ${catalog.size} agents are in the catalog; try broader keywords.`,
      }
    }

    for (const { entry } of matches) unlocked.add(entry.agent)

    const lines = matches.map(({ entry }) => `- ${entry.agent}: ${entry.description}`)

    return {
      result:
        `Unlocked for this session (pass the name as subagent_type to the Agent tool):\n${lines.join('\n')}`,
    }
  }).catch(() => ({ result: 'find_agent failed; use a listed agent or general-purpose instead.' }))
}
