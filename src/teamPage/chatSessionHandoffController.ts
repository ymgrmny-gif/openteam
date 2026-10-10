import type { GroupChat, GroupRole, OpenTeamStore } from '../group/types'

interface HandoffControllerDependencies {
  getStore(): OpenTeamStore
  getCurrentChat(): GroupChat | undefined
  reconnectRolesForSend(chat: GroupChat, roles: GroupRole[]): Promise<void>
  runCommand(type: string, payload?: Record<string, unknown>): Promise<void>
  refreshStore(showFailure?: boolean): Promise<void>
  showError(message: string): void
  log: { warn(event: string, details?: Record<string, unknown>): void }
  now?(): number
}

const HANDOFF_TIMEOUT_MS = 120_000

/**
 * The role ID survives chat rotation. A new model conversation is ONLY trusted
 * after a dedicated acknowledgement from that new conversation.
 *
 * This coordinator deliberately does not replay an in-flight tool/task prompt.
 * Runs only for the currently hosted room; no global browser automation.
 */
export function createChatSessionHandoffController(deps: HandoffControllerDependencies) {
  const inFlight = new Set<string>()
  const refused = new Set<string>()
  const now = deps.now ?? Date.now

  async function step(chat: GroupChat, role: GroupRole): Promise<void> {
    const key = `${chat.id}:${role.id}`
    if (inFlight.has(key) || refused.has(key)) return
    inFlight.add(key)
    try {
      const meta = role.conversationHandoff
      if (!meta) {
        if (role.chatSite !== 'chatgpt' || role.modelSource === 'external' ||
            role.siteHealth?.status !== 'blocked' || role.siteHealth.detail !== 'CONVERSATION_EXHAUSTED') return

        if (role.status === 'thinking' || role.lastPromptMessageId) return
        // Never rotate if a delivery may have been applied but its reply was lost.
        const isUnresolved = chat.messageIds.some(id => {
          const status = deps.getStore().messagesById[id]?.deliveryStatus?.[role.id]
          return status === 'pending' || status === 'sent'
        })
        if (isUnresolved) throw new Error('Teslimi belirsiz görev var; otomatik sohbet devri güvenli değil')

        await deps.runCommand('GROUP_ROLE_CHAT_HANDOFF', { chatId: chat.id, roleId: role.id })
        await deps.refreshStore(false)
      }

      const current = deps.getStore().rolesById[role.id]
      if (!current?.conversationHandoff) return
      const handoff = current.conversationHandoff
      if (handoff.phase === 'blocked' || handoff.phase === 'verified') return
      if (now() - handoff.startedAt > HANDOFF_TIMEOUT_MS) {
        await fail(chat, role, 'Yeni sohbetin görev devri zaman aşımına uğradı')
        return
      }

      if (handoff.phase === 'rotating') {
        await deps.reconnectRolesForSend(chat, [current])
        await deps.runCommand('GROUP_ROLE_REINITIALIZE', { chatId: chat.id, roleId: role.id })
        return
      }
      if (handoff.phase === 'initializing') {
        const state = deps.getStore()
        const liveRole = state.rolesById[role.id]
        const initMessageId = liveRole?.conversationHandoff?.initMessageId
        if (!initMessageId) return // Sending/ack pipeline still persisting the ID.
        const replies = chat.messageIds.map(id => state.messagesById[id])
        const answer = replies.find(m => m?.type === 'assistant' && m.roleId === role.id && m.sourceMessageId === initMessageId)
        if (answer && answer.content.trim() !== 'HAZIR_DEVIR') {
          await fail(chat, role, 'Yeni sohbet görev devrini doğru biçimde onaylamadı')
          return
        }
        if (answer?.content.trim() === 'HAZIR_DEVIR') {
          try {
            await deps.runCommand('GROUP_ROLE_CHAT_HANDOFF_VERIFY', { chatId: chat.id, roleId: role.id })
          } catch (error) {
            // A reply is not enough without a distinct, persisted conversation URL.
            if (now() - handoff.startedAt > HANDOFF_TIMEOUT_MS / 2) {
              await fail(chat, role, 'Yeni sohbet kimliği doğrulanamadı')
            } else {
              deps.log.warn('chat-handoff:verification-pending', { chatId: chat.id, roleId: role.id, reason: String(error) })
            }
          }
        }
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      deps.log.warn('chat-handoff:failed', { chatId: chat.id, roleId: role.id, reason })
      const state = deps.getStore().rolesById[role.id]
      if (state?.conversationHandoff && state.conversationHandoff.phase !== 'verified' &&
          state.conversationHandoff.phase !== 'blocked') {
        await fail(chat, role, reason)
      } else {
        refused.add(key)
        deps.showError(`${role.name}: ${reason}`)
      }
    } finally {
      inFlight.delete(key)
    }
  }

  async function fail(chat: GroupChat, role: GroupRole, reason: string): Promise<void> {
    try {
      await deps.runCommand('GROUP_ROLE_CHAT_HANDOFF_FAIL', { chatId: chat.id, roleId: role.id })
    } catch (error) {
      deps.log.warn('chat-handoff:mark-blocked-failed', { chatId: chat.id, roleId: role.id, reason: String(error) })
    }
    deps.showError(`${role.name}: ${reason}. Görevler tekrar çalıştırılmadı.`)
  }

  function check(): void {
    const chat = deps.getCurrentChat()
    if (!chat) return
    for (const roleId of chat.roleIds) {
      const role = deps.getStore().rolesById[roleId]
      if (!role || (role.modelSource === 'external')) continue
      if ((role.siteHealth?.status === 'blocked' && role.siteHealth.detail === 'CONVERSATION_EXHAUSTED') ||
        (role.conversationHandoff && role.conversationHandoff.phase !== 'verified' &&
          role.conversationHandoff.phase !== 'blocked')) {
        void step(chat, role)
      }
    }
  }
  return { check }
}
