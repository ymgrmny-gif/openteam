import { describe, expect, it, vi } from 'vitest'
import { createSitePromptDeliveryLimiter } from './sitePromptDeliveryLimiter'

describe('ChatGPT draft-sensitive site delivery', () => {
  it('serializes ChatGPT role sends until the first reply is completed', async () => {
    const events: string[] = []
    const limiter = createSitePromptDeliveryLimiter({
      log: { info: vi.fn(), warn: vi.fn() },
    })
    const make = (roleId: string) => ({
      chatId: 'sandbox-chat',
      messageId: 'task-1',
      roleId,
      chatSite: 'chatgpt' as const,
      send: async () => {
        events.push(roleId)
        return true
      },
    })
    await limiter.enqueue(make('worker-a'))
    await limiter.enqueue(make('worker-b'))
    expect(events).toEqual(['worker-a'])
    await limiter.complete('sandbox-chat', 'task-1', 'worker-a')
    expect(events).toEqual(['worker-a', 'worker-b'])
    await limiter.complete('sandbox-chat', 'task-1', 'worker-b')
  })

  it('does not serialize independent model sites by accident', async () => {
    const events: string[] = []
    const limiter = createSitePromptDeliveryLimiter({
      log: { info: vi.fn(), warn: vi.fn() },
    })
    await limiter.enqueue({
      chatId: 'sandbox-chat',
      messageId: 'task-1',
      roleId: 'chatgpt-worker',
      chatSite: 'chatgpt',
      send: async () => { events.push('chatgpt'); return true },
    })
    await limiter.enqueue({
      chatId: 'sandbox-chat',
      messageId: 'task-1',
      roleId: 'gemini-worker',
      chatSite: 'gemini',
      send: async () => { events.push('gemini'); return true },
    })
    expect(events).toEqual(['chatgpt', 'gemini'])
  })
})
