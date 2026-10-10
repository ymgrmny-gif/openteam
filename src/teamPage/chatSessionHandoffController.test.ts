import { describe, expect, it, vi } from 'vitest'
import { createDefaultStore } from '../group/store'
import type { GroupChat, GroupRole, OpenTeamStore } from '../group/types'
import { createChatSessionHandoffController } from './chatSessionHandoffController'

function fixture(status: 'CONVERSATION_EXHAUSTED' | 'ACCOUNT_QUOTA' = 'CONVERSATION_EXHAUSTED') {
  const store: OpenTeamStore = createDefaultStore()
  const chat: GroupChat = {
    id: 'chat-1', name: 'RD2', mode: 'collaborative', roleIds: ['role-1'],
    messageIds: [], nextMessageSeq: 1, status: 'ready', createdAt: 1, updatedAt: 1,
  }
  const role: GroupRole = {
    id: 'role-1', chatId: chat.id, name: 'Engineer A', chatSite: 'chatgpt',
    status: 'ready', contextCursor: 0, createdAt: 1, updatedAt: 1,
    geminiConversationUrl: 'https://chatgpt.com/c/previous',
    siteHealth: { siteId: 'chatgpt', status: 'blocked', detail: status, updatedAt: 1 },
  }
  store.chatsById[chat.id] = chat
  store.rolesById[role.id] = role
  store.messagesById = {}
  const runCommand = vi.fn(async (command: string) => {
    if (command === 'GROUP_ROLE_CHAT_HANDOFF') {
      role.conversationHandoff = {
        phase: 'rotating', startedAt: 1000, previousConversationUrl: role.geminiConversationUrl,
        checkpointSeq: 0, checkpointHistory: 'Prior verified progress',
      }
      delete role.geminiConversationUrl
      delete role.siteHealth
      role.status = 'loading'
    }
    if (command === 'GROUP_ROLE_REINITIALIZE') {
      role.conversationHandoff!.phase = 'initializing'
      role.conversationHandoff!.initMessageId = 'init-1'
      role.status = 'thinking'
    }
    if (command === 'GROUP_ROLE_CHAT_HANDOFF_VERIFY') role.conversationHandoff!.phase = 'verified'
    if (command === 'GROUP_ROLE_CHAT_HANDOFF_FAIL') role.conversationHandoff!.phase = 'blocked'
  })
  const reconnectRolesForSend = vi.fn(async () => { role.status = 'ready' })
  const showError = vi.fn()
  const deps = {
    getStore: () => store,
    getCurrentChat: () => chat,
    reconnectRolesForSend, runCommand, refreshStore: vi.fn(async () => undefined),
    showError, log: { warn: vi.fn() }, now: () => 1000,
  }
  return { store, chat, role, runCommand, reconnectRolesForSend, showError, deps }
}

describe('role chat handoff coordinator', () => {
  it('rotates an idle exhausted conversation exactly once and verifies only a matching new reply', async () => {
    const f = fixture()
    const controller = createChatSessionHandoffController(f.deps)
    controller.check()
    controller.check()
    await vi.waitFor(() => expect(f.runCommand).toHaveBeenCalledWith('GROUP_ROLE_REINITIALIZE', { chatId: 'chat-1', roleId: 'role-1' }))
    expect(f.runCommand.mock.calls.filter(c => c[0] === 'GROUP_ROLE_CHAT_HANDOFF')).toHaveLength(1)
    expect(f.reconnectRolesForSend).toHaveBeenCalledTimes(1)
    f.role.geminiConversationUrl = 'https://chatgpt.com/c/new-conversation'
    f.role.status = 'ready'
    f.role.siteHealth = { siteId: 'chatgpt', status: 'ready', updatedAt: 1100 }
    f.chat.messageIds.push('reply-1')
    f.store.messagesById['reply-1'] = {
      id: 'reply-1', chatId: 'chat-1', seq: 1, type: 'assistant', roleId: 'role-1',
      content: 'HAZIR_DEVIR', sourceMessageId: 'init-1', status: 'received', createdAt: 1100,
    }
    controller.check()
    await vi.waitFor(() => expect(f.runCommand).toHaveBeenCalledWith('GROUP_ROLE_CHAT_HANDOFF_VERIFY', { chatId: 'chat-1', roleId: 'role-1' }))
    expect(f.role.conversationHandoff?.phase).toBe('verified')
    expect(f.showError).not.toHaveBeenCalled()
  })
  it('never treats account quota as a conversation-length problem', () => {
    const f = fixture('ACCOUNT_QUOTA')
    createChatSessionHandoffController(f.deps).check()
    expect(f.runCommand).not.toHaveBeenCalled()
  })
  it('refuses uncertain in-flight deliveries rather than replaying them', async () => {
    const f = fixture()
    f.chat.messageIds.push('m-1')
    f.store.messagesById['m-1'] = {
      id: 'm-1', chatId: 'chat-1', seq: 1, type: 'user', content: 'possibly sent task',
      status: 'sent', deliveryStatus: { 'role-1': 'sent' }, createdAt: 1,
    }
    const controller = createChatSessionHandoffController(f.deps)
    controller.check()
    await vi.waitFor(() => expect(f.showError).toHaveBeenCalledTimes(1))
    controller.check()
    expect(f.runCommand).not.toHaveBeenCalled()
  })
  it('resumes an initializing handoff after reload without resending initialization', async () => {
    const f = fixture()
    f.role.conversationHandoff = {
      phase: 'initializing', startedAt: 1000, checkpointSeq: 1,
      checkpointHistory: 'state', initMessageId: 'init-1',
      previousConversationUrl: 'https://chatgpt.com/c/previous',
    }
    f.role.geminiConversationUrl = 'https://chatgpt.com/c/new'
    f.role.status = 'ready'
    f.role.siteHealth = { siteId: 'chatgpt', status: 'ready', updatedAt: 1000 }
    f.chat.messageIds.push('answer')
    f.store.messagesById.answer = {
      id: 'answer', chatId: f.chat.id, seq: 1, type: 'assistant', roleId: f.role.id,
      sourceMessageId: 'init-1', content: 'HAZIR_DEVIR', status: 'received', createdAt: 1001,
    }
    createChatSessionHandoffController(f.deps).check()
    await vi.waitFor(() => expect(f.runCommand).toHaveBeenCalledWith('GROUP_ROLE_CHAT_HANDOFF_VERIFY', expect.anything()))
    expect(f.runCommand).not.toHaveBeenCalledWith('GROUP_ROLE_REINITIALIZE', expect.anything())
  })
  it('blocks incorrect acknowledgement and does not replay work', async () => {
    const f = fixture()
    f.role.conversationHandoff = {
      phase: 'initializing', startedAt: 1000, checkpointSeq: 1, checkpointHistory: '',
      initMessageId: 'init-1', previousConversationUrl: 'https://chatgpt.com/c/previous',
    }
    f.chat.messageIds.push('answer')
    f.store.messagesById.answer = {
      id: 'answer', chatId: f.chat.id, seq: 1, type: 'assistant', roleId: f.role.id,
      sourceMessageId: 'init-1', content: 'unexpected response', status: 'received', createdAt: 1001,
    }
    createChatSessionHandoffController(f.deps).check()
    await vi.waitFor(() => expect(f.runCommand).toHaveBeenCalledWith('GROUP_ROLE_CHAT_HANDOFF_FAIL', expect.anything()))
    await vi.waitFor(() => expect(f.showError).toHaveBeenCalled())
  })
})
