// Request-level receipt proxy for the benchmark. Claude Code points at it
// with ANTHROPIC_BASE_URL; every request is forwarded unchanged to the real
// API and streamed back. One JSON line per request goes to the receipt log
// with only: time, path, model, the names of the tools offered, the number
// of messages, the byte sizes of the tool definitions and of the whole body,
// the response status and the API request id. Headers (and so
// credentials) and message contents are never written.
//
//   bun bench/proxy.ts <port> <receipts.jsonl>

import { appendFileSync } from 'node:fs'

const UPSTREAM = 'https://api.anthropic.com'
const port = Number(process.argv[2] ?? 8790)
const log = process.argv[3] ?? 'receipts.jsonl'

Bun.serve({
  hostname: '127.0.0.1',
  port,
  idleTimeout: 255,
  async fetch(req) {
    const url = new URL(req.url)
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer()
    const headers = new Headers(req.headers)
    headers.delete('host')
    headers.delete('accept-encoding')
    const res = await fetch(UPSTREAM + url.pathname + url.search, { method: req.method, headers, body })

    if (url.pathname.endsWith('/messages') && body) {
      let parsed: { model?: string; tools?: { name?: string }[]; messages?: unknown[] } = {}
      try {
        parsed = JSON.parse(new TextDecoder().decode(body))
      } catch {}
      appendFileSync(log, JSON.stringify({
        t: new Date().toISOString(),
        path: url.pathname,
        model: parsed.model,
        tools: (parsed.tools ?? []).map(tool => tool.name),
        tools_bytes: JSON.stringify(parsed.tools ?? []).length,
        body_bytes: body.byteLength,
        messages: parsed.messages?.length ?? 0,
        status: res.status,
        request_id: res.headers.get('request-id'),
      }) + '\n')
    }

    const out = new Headers(res.headers)
    out.delete('content-encoding')
    out.delete('content-length')
    return new Response(res.body, { status: res.status, headers: out })
  },
})
console.error(`receipt proxy on 127.0.0.1:${port} -> ${log}`)
