import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultStore } from '../group/store'
import type { GroupRole, OpenTeamStore } from '../group/types'

let store: OpenTeamStore
let removeRole: ReturnType<typeof vi.fn>
let broadcast: (store: OpenTeamStore, excludeTabId?: number) => void | Promise<void>

beforeEach(() => {
  vi.resetModules()
  store = createDefaultStore()
  store.chatsById['chat-1'] = {
    id: 'chat-1', name: 'RD2', mode: 'independent', roleIds: ['role-1'],
    messageIds: ['m-1'], nextMessageSeq: 2, status: 'ready', createdAt: 1, updatedAt: 1,
  }
  store.rolesById['role-1'] = {
    id: 'role-1', chatId: 'chat-1', name: 'Manager',
    chatSite: 'chatgpt', status: 'ready', contextCursor: 1,
    geminiConversationUrl: 'https://chatgpt.com/c/old-1',
    siteHealth: { siteId: 'chatgpt', status: 'blocked', detail: 'CONVERSATION_EXHAUSTED', updatedAt: 990 },
    createdAt: 1, updatedAt: 1,
  }
  store.messagesById['m-1'] = {
    id: 'm-1', chatId: 'chat-1', seq: 1, type: 'user', content: 'Audit contracts',
    status: 'received', deliveryStatus: { 'role-1': 'received' }, createdAt: 1,
  }
  removeRole = vi.fn()
  broadcast = vi.fn(async () => undefined)
  vi.doMock('./storeAccess', async importOriginal => {
    const actual = await importOriginal<typeof import('./storeAccess')>()
    return {
      ...actual,
      mutateStore: vi.fn(async (mutator: (s: OpenTeamStore) => unknown) => {
        const result = await mutator(store)
        return { store, result }
      }),
    }
  })
})

async function routes() {
  const { createRoleHandlers } = await import('./roleHandlers')
  return createRoleHandlers({
    broadcastStoreUpdated: broadcast,
    log: { info: vi.fn(), warn: vi.fn() },
    newId: vi.fn((prefix: string) => prefix + '-1'),
    now: vi.fn(() => 1000),
    runtimeFrames: { getByRole: vi.fn(() => ({ chatId: 'chat-1', roleId: 'role-1', tabId: 4, frameId: 2, ready: true, lastSeenAt: 0 })), removeRole },
    sendPrompt: vi.fn(),
  })
}
async function invoke(type: string) {
  const handlers = await routes()
  const handler = handlers.find(route => route.type === type)?.handler
  if (!handler) throw new Error('missing ' + type)
  return handler({ type, chatId: 'chat-1', roleId: 'role-1' }, {})
}

describe('bounded role chat handoff commands', () => {
  it('preserves stable ID and checkpoint and clears old conversation on verified exhaustion', async () => {
    await invoke('GROUP_ROLE_CHAT_HANDOFF')
    const role = store.rolesById['role-1']
    expect(role.id).toBe('role-1')
    expect(role.geminiConversationUrl).toBeUndefined()
    expect(role.conversationHandoff).toMatchObject({
      phase: 'rotating', previousConversationUrl: 'https://chatgpt.com/c/old-1',
      checkpointSeq: 1, checkpointHistory: expect.stringContaining('Audit contracts'),
    })
    expect(role.contextCursor).toBe(1)
    expect(removeRole).toHaveBeenCalledWith('chat-1', 'role-1')
    expect(store.messagesById['m-1'].content).toBe('Audit contracts')
  })
  it('refuses a running worker, unacknowledged prompt, or quota warning without losing its old URL', async () => {
    const role = store.rolesById['role-1']
    role.lastPromptMessageId = 'm-1'
    await expect(invoke('GROUP_ROLE_CHAT_HANDOFF')).rejects.toThrow('Aktif veya belirsiz')
    expect(role.geminiConversationUrl).toContain('old-1')
    delete role.lastPromptMessageId
    store.messagesById['m-1'].deliveryStatus!['role-1'] = 'sent'
    await expect(invoke('GROUP_ROLE_CHAT_HANDOFF')).rejects.toThrow('Aktif veya belirsiz')
    store.messagesById['m-1'].deliveryStatus!['role-1'] = 'received'
    role.siteHealth!.detail = 'ACCOUNT_QUOTA'
    await expect(invoke('GROUP_ROLE_CHAT_HANDOFF')).rejects.toThrow('uzunluğu sınırı')
    expect(removeRole).not.toHaveBeenCalled()
  })
  it('requires a fresh conversation ID and exact handoff reply before accepting', async () => {
    await invoke('GROUP_ROLE_CHAT_HANDOFF')
    const role: GroupRole = store.rolesById['role-1']
    role.status = 'ready'
    role.siteHealth = { siteId: 'chatgpt', status: 'ready', updatedAt: 1100 }
    role.conversationHandoff!.phase = 'initializing'
    role.conversationHandoff!.initMessageId = 'init-1'
    role.geminiConversationUrl = 'https://chatgpt.com/c/old-1?new=1'
    store.chatsById['chat-1'].messageIds.push('ack')
    store.messagesById.ack = {
      id: 'ack', chatId: 'chat-1', seq: 2, type: 'assistant',
      roleId: 'role-1', sourceMessageId: 'init-1', content: 'HAZIR_DEVIR',
      createdAt: 1100, status: 'received',
    }
    await expect(invoke('GROUP_ROLE_CHAT_HANDOFF_VERIFY')).rejects.toThrow('kimliği')
    role.geminiConversationUrl = 'https://chatgpt.com/c/new-1'
    store.messagesById.ack.content = 'almost ready'
    await expect(invoke('GROUP_ROLE_CHAT_HANDOFF_VERIFY')).rejects.toThrow('kimliği')
    store.messagesById.ack.content = 'HAZIR_DEVIR'
    await invoke('GROUP_ROLE_CHAT_HANDOFF_VERIFY')
    expect(role.conversationHandoff?.phase).toBe('verified')
  })
})
