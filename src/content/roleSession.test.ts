import { describe, expect, it, vi } from 'vitest'
import { createRoleSession } from './roleSession'
import type { ChatSiteAdapter } from './sites/types'
import type { ContentLogger } from './runtimeClient'

describe('iframe role assignment is idempotent', () => {
  function setup() {
    const onAssigned = vi.fn()
    const role = createRoleSession({
      siteAdapter: { getConversationId: () => 'sandbox-conversation' } as ChatSiteAdapter,
      log: { info: vi.fn() } as unknown as ContentLogger,
      onAssigned,
    })
    return { role, onAssigned }
  }

  it('preserves in-flight prompts when the same role assignment is retried', () => {
    const { role, onAssigned } = setup()
    const identity = { chatId: 'test-chat', roleId: 'worker-1', roleName: 'ProductManager' }
    role.assignRole(identity)
    role.startPrompt('message-42', 'attempt-9')
    role.assignRole({ ...identity, roomId: 'test-chat' })
    expect(role.getActivePrompt()).toEqual({ messageId: 'message-42', replyAttemptId: 'attempt-9' })
    expect(onAssigned).toHaveBeenCalledTimes(1)
    expect(role.getAssignedRole()?.roomId).toBe('test-chat')
  })

  it('clears an active prompt when a different role is assigned', () => {
    const { role, onAssigned } = setup()
    role.assignRole({ chatId: 'test-chat', roleId: 'worker-1' })
    role.startPrompt('message-42', 'attempt-9')
    role.assignRole({ chatId: 'test-chat', roleId: 'worker-2' })
    expect(role.getActivePrompt()).toBeUndefined()
    expect(onAssigned).toHaveBeenCalledTimes(2)
  })

  it('treats the same roleId in another chat as a different assignment', () => {
    const { role, onAssigned } = setup()
    role.assignRole({ chatId: 'test-chat', roleId: 'worker-1' })
    role.startPrompt('message-42')
    role.assignRole({ chatId: 'another-chat', roleId: 'worker-1' })
    expect(role.getActiveMessageId()).toBeUndefined()
    expect(onAssigned).toHaveBeenCalledTimes(2)
  })
})
