// Turns a bench/run.sh output folder into receipts and a summary.
//
//   bun bench/report.ts <out>
//
// Writes <out>/receipts.json: per run, every API request (id, who sent it,
// model, tools offered, usage), the agent each Agent call dispatched, the
// tools that agent was offered and used, and the SEO findings matched. It
// holds no prompts, file contents or headers, so it can be published.
// Prints a Markdown summary with cold and warm runs apart.

import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

type Usage = { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
type Row = Record<string, any>

const out = process.argv[2]
if (!out) throw new Error('usage: bun bench/report.ts <out>')

const jsonl = (path: string): Row[] =>
  existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : []

const expected = JSON.parse(readFileSync(join(import.meta.dir, 'expected-seo.json'), 'utf8'))
const proxy = new Map(jsonl(join(out, 'receipts.jsonl')).map(r => [r.request_id, r]))

// Frontmatter `tools:` of a user agent, looked up by its `name:`.
const agentTools = (name: string): string[] | undefined => {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap(e =>
      e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.md') ? [join(dir, e.name)] : [])
  for (const file of walk(join(homedir(), '.claude', 'agents'))) {
    const text = readFileSync(file, 'utf8')
    if (new RegExp(`^name:\\s*["']?${name}["']?\\s*$`, 'm').test(text)) {
      const tools = text.match(/^tools:\s*(.+)$/m)?.[1]
      return tools?.split(',').map(t => t.trim()).filter(Boolean)
    }
  }
}

// One entry per API request: the last transcript row of a request id carries its final usage.
const requests = (rows: Row[], who: string) => {
  const byId = new Map<string, Row>()
  for (const row of rows) if (row.type === 'assistant' && row.requestId) byId.set(row.requestId, row)
  return [...byId.values()].map(row => {
    const usage: Usage = row.message?.usage ?? {}
    const receipt = proxy.get(row.requestId)
    return {
      request_id: row.requestId,
      who,
      model: row.message?.model,
      tools_offered: receipt?.tools,
      tools_bytes: receipt?.tools_bytes,
      body_bytes: receipt?.body_bytes,
      input: usage.input_tokens ?? 0,
      output: usage.output_tokens ?? 0,
      cache_read: usage.cache_read_input_tokens ?? 0,
      cache_write: usage.cache_creation_input_tokens ?? 0,
    }
  })
}

const toolUses = (rows: Row[]) =>
  rows.filter(r => r.type === 'assistant').flatMap(r =>
    (Array.isArray(r.message?.content) ? r.message.content : []).filter((c: Row) => c.type === 'tool_use'))

const runs = jsonl(join(out, 'runs.jsonl')).map(run => {
  const dir = join(out, run.run)
  const stream = jsonl(join(out, `${run.run}.stream.jsonl`))
  const result = stream.find(e => e.type === 'result') ?? {}
  const init = stream.find(e => e.type === 'system' && e.subtype === 'init') ?? {}
  const main = jsonl(join(dir, 'session.jsonl'))
  const mainUses = toolUses(main)
  const listing = main.filter(r => r.attachment?.type === 'agent_listing_delta')
  const children = existsSync(join(dir, 'subagents'))
    ? readdirSync(join(dir, 'subagents')).filter(f => f.endsWith('.meta.json')).map(f => {
        const meta = JSON.parse(readFileSync(join(dir, 'subagents', f), 'utf8'))
        const rows = jsonl(join(dir, 'subagents', f.replace('.meta.json', '.jsonl')))
        const reqs = requests(rows, `subagent:${meta.agentType}`)
        const frontmatter = agentTools(meta.agentType)
        const offered = [...new Set(reqs.flatMap(r => r.tools_offered ?? []))].sort()
        return {
          agent: meta.agentType,
          requests: reqs,
          tools_offered: offered,
          tools_used: [...new Set(toolUses(rows).map((u: Row) => u.name))].sort(),
          frontmatter_tools: frontmatter,
          offered_outside_frontmatter: frontmatter ? offered.filter(t => !frontmatter.includes(t)) : undefined,
          frontmatter_not_offered: frontmatter ? frontmatter.filter(t => !offered.includes(t)) : undefined,
        }
      })
    : []
  const mainReqs = requests(main, 'main')
  const text = String(result.result ?? '')
  const findings = run.task === 'seo'
    ? expected.findings.filter((f: Row) => new RegExp(f.pattern, 'i').test(text)).map((f: Row) => f.id)
    : undefined
  const first = mainReqs[0]
  return {
    ...run,
    ok: result.subtype === 'success' && !result.is_error,
    cost_usd: result.total_cost_usd,
    turns: result.num_turns,
    duration_ms: result.duration_ms,
    cold: first ? first.cache_write > first.cache_read : undefined,
    agents_in_init: Array.isArray(init.agents) ? init.agents.length : undefined,
    listing_bytes: listing.reduce((n, r) => n + JSON.stringify(r.attachment.addedLines ?? []).length, 0),
    agent_calls: mainUses.filter((u: Row) => u.name === 'Agent' || u.name === 'Task').map((u: Row) => u.input?.subagent_type ?? 'general-purpose'),
    find_agent_calls: mainUses.filter((u: Row) => String(u.name).endsWith('find_agent')).length,
    requests: [...mainReqs, ...children.flatMap(c => c.requests)],
    children: children.map(({ requests: _, ...c }) => c),
    findings,
    findings_total: run.task === 'seo' ? expected.findings.length : undefined,
    unmatched_requests: [...mainReqs, ...children.flatMap(c => c.requests)].filter(r => !r.tools_offered).length,
  }
})

writeFileSync(join(out, 'receipts.json'), JSON.stringify({ schema: 'lazy-agents.bench/v1', runs }, null, 1))

const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN
const fmt = (x: number, d = 3) => Number.isNaN(x) ? '-' : x.toFixed(d)
const lines = ['| Task | Version | Cache | Runs | Cost (mean) | Turns | Routed to expected agent | Findings |', '|---|---|---|---|---|---|---|---|']
for (const task of ['seo', 'idle'])
  for (const version of ['off', 'on'])
    for (const cold of [true, false]) {
      const rs = runs.filter(r => r.task === task && r.version === version && r.cold === cold && r.ok)
      if (!rs.length) continue
      const routed = task === 'seo' ? `${rs.filter(r => r.agent_calls.includes(expected.agent)).length}/${rs.length}` : '-'
      const found = task === 'seo' ? `${fmt(mean(rs.map(r => r.findings!.length)), 1)}/${expected.findings.length}` : '-'
      lines.push(`| ${task} | ${version === 'on' ? 'lazy-agents' : 'no mod'} | ${cold ? 'cold' : 'warm'} | ${rs.length} | $${fmt(mean(rs.map(r => r.cost_usd)))} | ${fmt(mean(rs.map(r => r.turns)), 1)} | ${routed} | ${found} |`)
    }
const failed = runs.filter(r => !r.ok).map(r => r.run)
console.log(lines.join('\n'))
if (failed.length) console.log(`\nFailed runs: ${failed.join(', ')}`)
const unmatched = runs.reduce((n, r) => n + r.unmatched_requests, 0)
if (unmatched) console.log(`\nRequests without a proxy receipt: ${unmatched}`)
