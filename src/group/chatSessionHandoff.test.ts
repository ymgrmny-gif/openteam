import { describe, expect, it } from 'vitest'
import { buildHandoffCheckpoint, buildHandoffResumePrompt, detectChatSessionLimit } from './chatSessionHandoff'
import type { GroupChat, GroupRole, OpenTeamStore } from './types'

describe('chat-session handoff safety', () => {
  it('recognizes explicit conversation maximum warnings in Turkish and English', () => {
    expect(detectChatSessionLimit('Bu konuşma için maksimum süreye ulaştın ama yeni bir sohbet başlatarak konuşmaya devam edebilirsin.')).toBe('conversation_exhausted')
    expect(detectChatSessionLimit('This conversation has reached its maximum length. Start a new chat.')).toBe('conversation_exhausted')
  })
  it('does not mistake usage quotas for a new-chat-solvable limit', () => {
    expect(detectChatSessionLimit("You've reached your usage limit.")).toBe('account_quota')
    expect(detectChatSessionLimit('You have reached your message limit. This conversation has reached its maximum length.')).toBe('account_quota')
  })
  it('does not classify ordinary replies or errors', () => {
    expect(detectChatSessionLimit('Stop sending messages for now')).toBeUndefined()
    expect(detectChatSessionLimit('Access Denied')).toBeUndefined()
    expect(detectChatSessionLimit('')).toBeUndefined()
  })
  it('builds bounded context without collecting unrelated role messages', () => {
    const chat = { id: 'chat-a', nextMessageSeq: 4, messageIds: ['m1', 'm2', 'm3'] } as GroupChat
    const role = { id: 'role-a', chatId: 'chat-a', name: 'Engineer A', geminiConversationUrl: 'https://chatgpt.com/c/old', lastPromptMessageId: 'm1' } as GroupRole
    const store = { messagesById: {
      m1: { id: 'm1', type: 'user', content: 'Implement contract', seq: 1 },
      m2: { id: 'm2', type: 'assistant', roleId: 'role-b', content: 'Another private conversation', seq: 2 },
      m3: { id: 'm3', type: 'assistant', roleId: 'role-a', content: 'Tests pending', seq: 3 },
    } } as unknown as OpenTeamStore
    const checkpoint = buildHandoffCheckpoint(store, chat, role)
    expect(checkpoint.oldConversationUrl).toBe('https://chatgpt.com/c/old')
    expect(checkpoint.history).toContain('Implement contract')
    expect(checkpoint.history).toContain('Tests pending')
    expect(checkpoint.history).not.toContain('Another private conversation')
    expect(buildHandoffResumePrompt(checkpoint)).toContain('otomatik yeniden yürütme')
    expect(buildHandoffResumePrompt(checkpoint)).toContain('HAZIR_DEVIR')
  })
})
