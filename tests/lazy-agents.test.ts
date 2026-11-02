import { expect, test } from 'claude-code/testing'

const provider = { plugin: 'engine', tier: 'core' } as never

const offer = (agent: string, source: string, description = `${agent} specialist`) => ({
  agent,
  description,
  source,
  provider,
})

test('user agents are hidden, pinned, built-in and project agents stay', async ($, on) => {
  on('agent.offer', () => ({ isOffered: true }))

  expect(await $.agent.offer(offer('Douyin Strategist', 'userSettings'))).toEqual({ isOffered: false })
  expect(await $.agent.offer(offer('review-risk', 'userSettings'))).toEqual({ isOffered: true })
  expect(await $.agent.offer(offer('Explore', 'built-in'))).toEqual({ isOffered: true })
  expect(await $.agent.offer(offer('gameplay-programmer', 'projectSettings'))).toEqual({ isOffered: true })
})

test('find_agent unlocks the matching agents only', async ($, on) => {
  on('agent.offer', () => ({ isOffered: true }))

  await $.agent.offer(offer('Godot Shader Developer', 'userSettings', 'Godot 4 shaders and VFX'))
  await $.agent.offer(offer('Weibo Strategist', 'userSettings', 'Sina Weibo marketing'))

  const found = await $.tool.call({ tool: 'mcp__lazy-agents__find_agent', query: 'godot shader' })
  expect(String(found.result)).toContain('Godot Shader Developer')
  expect(String(found.result)).not.toContain('Weibo')

  expect(await $.agent.offer(offer('Godot Shader Developer', 'userSettings'))).toEqual({ isOffered: true })
  expect(await $.agent.offer(offer('Weibo Strategist', 'userSettings'))).toEqual({ isOffered: false })
})

test('find_agent reads agent files when the engine has offered none yet', async ($, on) => {
  on('agent.offer', () => ({ isOffered: true }))
  on('env.get', () => ({ value: '/home/t' }))
  on('fs.list', (_, e) =>
    ({
      value: String((e as { path?: string }).path).endsWith('/agents')
        ? [
            { name: 'marketing', kind: 'dir' },
            { name: 'review-risk.md', kind: 'file' },
            { name: 'README.md', kind: 'file' },
          ]
        : [{ name: 'seo.md', kind: 'file' }],
    }) as never,
  )
  on('fs.read', (_, e) => {
    const path = String((e as { path?: string }).path)
    const text = path.endsWith('seo.md')
      ? '---\nname: SEO Specialist\ndescription: Organic search ranking\n---\nbody'
      : path.endsWith('review-risk.md')
        ? '---\nname: review-risk\ndescription: Risk reviewer\n---\n'
        : '# readme'
    return { value: text } as never
  })

  const found = await $.tool.call({ tool: 'mcp__lazy-agents__find_agent', query: 'seo ranking' })
  expect(String(found.result)).toContain('SEO Specialist')
  expect(String(found.result)).not.toContain('review-risk')
  expect(await $.agent.offer(offer('SEO Specialist', 'userSettings'))).toEqual({ isOffered: true })
})

test('an unlocked agent is still refused when the engine refuses it', async ($, on) => {
  on('agent.offer', () => ({ isOffered: false }))

  await $.agent.offer(offer('Godot Shader Developer', 'userSettings', 'Godot 4 shaders'))
  await $.tool.call({ tool: 'mcp__lazy-agents__find_agent', query: 'godot' })

  expect(await $.agent.offer(offer('Godot Shader Developer', 'userSettings'))).toEqual({ isOffered: false })
})

test('a huge query is bounded and still answers', async ($, on) => {
  on('agent.offer', () => ({ isOffered: true }))

  await $.agent.offer(offer('Weibo Strategist', 'userSettings', 'Sina Weibo marketing'))

  const found = await $.tool.call({
    tool: 'mcp__lazy-agents__find_agent',
    query: `${'(a+)+ '.repeat(5000)}weibo`,
  })
  expect(String(found.result)).toContain('No hidden agent matches')
})

test('a direct Agent dispatch unlocks only the hidden agent it names', async ($, on) => {
  on('agent.offer', () => ({ isOffered: true }))
  on('tool.call', () => ({ result: 'dispatched' }))

  await $.agent.offer(offer('SEO Specialist', 'userSettings'))
  await $.agent.offer(offer('Weibo Strategist', 'userSettings'))

  const call = await $.tool.call({ tool: 'Agent', subagent_type: 'SEO Specialist', description: 'seo', prompt: 'review' })
  expect(call.result).toBe('dispatched')

  expect(await $.agent.offer(offer('SEO Specialist', 'userSettings'))).toEqual({ isOffered: true })
  expect(await $.agent.offer(offer('Weibo Strategist', 'userSettings'))).toEqual({ isOffered: false })
})

test('find_agent with no match unlocks nothing', async ($, on) => {
  on('agent.offer', () => ({ isOffered: true }))

  await $.agent.offer(offer('Weibo Strategist', 'userSettings', 'Sina Weibo marketing'))

  const found = await $.tool.call({ tool: 'mcp__lazy-agents__find_agent', query: 'kubernetes' })
  expect(String(found.result)).toContain('No hidden agent matches')
  expect(await $.agent.offer(offer('Weibo Strategist', 'userSettings'))).toEqual({ isOffered: false })
})
