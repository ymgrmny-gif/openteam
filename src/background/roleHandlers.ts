import { extractSupportedConversationId, getDefaultChatSiteUrlForRole, normalizeSupportedChatConversationUrl } from '../group/conversationUrl'
import { buildRoleTemplatePersonaPrompt, parseGeneratedPersonDraft } from '../group/personaGeneration'
import { buildHandoffCheckpoint, buildHandoffResumePrompt } from '../group/chatSessionHandoff'
import { buildReinitPrompt, roleUsesChatGptGptsPersona } from '../group/promptBuilder'
import {
  createGroupRole,
  createGroupRolesBatch,
  createRoleTemplate,
  deleteGroupRole,
  deleteRoleTemplate,
  getRoleTemplateUsage,
  updateGroupRole,
  updateRoleTemplate,
} from '../group/roleTemplates'
import type { ChatSite, OpenTeamStore } from '../group/types'
import type { BackgroundMessageRoute } from './messageRouter'
import type { ExternalModelClient } from './externalModelClient'
import type { PromptSender } from './promptDelivery'
import type { RuntimeMessage } from './runtimeClient'
import type { RuntimeFrameRegistry } from './runtimeFrames'
import { getChatRoles, mutateStore, requireChat, requireRole } from './storeAccess'

export const ROLE_ROUTE_TYPES = [
  'ROLE_TEMPLATE_PERSONA_GENERATE',
  'ROLE_TEMPLATE_CREATE',
  'ROLE_TEMPLATE_UPDATE',
  'ROLE_TEMPLATE_DELETE',
  'GROUP_ROLE_CREATE',
  'GROUP_ROLES_CREATE_BATCH',
  'GROUP_ROLE_UPDATE',
  'GROUP_ROLE_DELETE',
  'GROUP_ROLE_RECOVER',
  'GROUP_ROLE_REINITIALIZE',
  'GROUP_ROLE_CHAT_HANDOFF',
  'GROUP_ROLE_CHAT_HANDOFF_VERIFY',
  'GROUP_ROLE_CHAT_HANDOFF_FAIL',
] as const

export interface RoleHandlersDependencies {
  broadcastStoreUpdated(store: OpenTeamStore, excludeTabId?: number): Promise<void> | void
  externalModelClient?: ExternalModelClient
  log: {
    info(event: string, details?: Record<string, unknown>): void
    warn(event: string, details?: Record<string, unknown>): void
  }
  newId(prefix: string): string
  now(): number
  runtimeFrames: Pick<RuntimeFrameRegistry, 'getByRole' | 'removeRole'>
  sendPrompt: PromptSender
}

export function createRoleHandlers(deps: RoleHandlersDependencies): BackgroundMessageRoute[] {
  const handleRoleTemplatePersonaGenerate = async (message: RuntimeMessage) => {
    const description = requireString(message.description, '请先描述想要生成的人设')
    const { result } = await mutateStore(store => {
      const modelId = readOptionalString(message.modelId) ?? store.settings.externalModelOrder[0]
      const model = modelId ? store.settings.externalModelsById[modelId] : undefined
      if (!model) throw new Error('请先配置外部模型后再使用 AI 生成人设')
      return { model, language: store.settings.language }
    })
    if (!deps.externalModelClient) throw new Error('AI 生成人设客户端不可用')

    const prompt = buildRoleTemplatePersonaPrompt({ description, language: result.language })
    const completion = await deps.externalModelClient.complete({ model: result.model, prompt })
    const persona = parseGeneratedPersonDraft(completion.content)
    deps.log.info('role-template-persona:generate', {
      modelId: result.model.id,
      descriptionLength: description.length,
      personaLength: persona.systemPrompt.length,
    })
    return { ok: true, persona }
  }

  const handleRoleTemplateCreate = async (message: RuntimeMessage) => {
    const { store, result } = await mutateStore(store => createRoleTemplate(store, {
      name: requireString(message.name, '人员名称不能为空'),
      description: readOptionalString(message.description),
      systemPrompt: readOptionalString(message.systemPrompt),
      defaultModelSource: readModelSource(message.defaultModelSource),
      defaultChatSite: readChatSite(message.defaultChatSite),
      defaultExternalModelId: readOptionalString(message.defaultExternalModelId),
      chatGptGptsUrl: readOptionalString(message.chatGptGptsUrl),
      grokProjectUrl: readOptionalString(message.grokProjectUrl),
    }, deps.newId('template'), deps.now()))
    deps.log.info('role-template:create', { templateId: result.id, nameLength: result.name.length, personaLength: result.systemPrompt.length })
    await deps.broadcastStoreUpdated(store)
    return { ok: true, template: result, store }
  }

  const handleRoleTemplateUpdate = async (message: RuntimeMessage) => {
    const patch = isRecord(message.patch) ? message.patch : message
    const { store, result } = await mutateStore(store => updateRoleTemplate(store, requireString(message.templateId, '缺少模板 ID'), {
      name: requireString(patch.name, '人员名称不能为空'),
      description: readOptionalString(patch.description),
      systemPrompt: readOptionalString(patch.systemPrompt),
      defaultModelSource: readModelSource(patch.defaultModelSource),
      defaultChatSite: readChatSite(patch.defaultChatSite),
      defaultExternalModelId: readOptionalString(patch.defaultExternalModelId),
      chatGptGptsUrl: readOptionalString(patch.chatGptGptsUrl),
      grokProjectUrl: readOptionalString(patch.grokProjectUrl),
    }, deps.now()))
    deps.log.info('role-template:update', { templateId: result.id, patchKeys: ['name', 'description', 'systemPrompt'], personaLength: result.systemPrompt.length })
    await deps.broadcastStoreUpdated(store)
    return { ok: true, template: result, store }
  }

  const handleRoleTemplateDelete = async (message: RuntimeMessage) => {
    const templateId = requireString(message.templateId, '缺少模板 ID')
    const { store } = await mutateStore(store => {
      const usage = getRoleTemplateUsage(store, templateId)
      if (usage.usedByChatIds.length > 0) {
        deps.log.warn('role-template:delete-denied', { templateId, usedByChatCount: usage.usedByChatIds.length })
      }
      deleteRoleTemplate(store, templateId)
    })
    deps.log.warn('role-template:delete', { templateId })
    await deps.broadcastStoreUpdated(store)
    return { ok: true, store }
  }

  const handleRoleCreate = async (message: RuntimeMessage) => {
    const timestamp = deps.now()
    const chatId = requireString(message.chatId, '缺少群聊 ID')
    const templateId = readOptionalString(message.roleTemplateId) ?? readOptionalString(message.templateId)
    const { store, result } = await mutateStore(store => createGroupRole(store, {
      chatId,
      createdBy: readRoleCreatedBy(message.createdBy),
      templateId,
      modelSource: readModelSource(message.modelSource),
      chatSite: readChatSite(message.chatSite),
      externalModelId: readOptionalString(message.externalModelId),
      name: readOptionalString(message.name),
      description: readOptionalString(message.description),
      systemPrompt: readOptionalString(message.systemPrompt),
      avatarColor: readOptionalString(message.avatarColor),
      chatGptGptsUrl: readOptionalString(message.chatGptGptsUrl),
      grokProjectUrl: readOptionalString(message.grokProjectUrl),
    }, deps.newId('role'), timestamp))
    deps.log.info('role-create:stored', { chatId, roleId: result.id, source: templateId ? 'library' : 'temporary' })
    await deps.broadcastStoreUpdated(store)
    return { ok: true, role: result, store }
  }

  const handleRolesCreateBatch = async (message: RuntimeMessage) => {
    const chatId = requireString(message.chatId, '缺少群聊 ID')
    const rawItems = Array.isArray(message.items) ? message.items : []
    deps.log.info('role-create-batch:start', { chatId, itemCount: rawItems.length, source: getRawBatchSource(rawItems) })

    try {
      const items = rawItems.map(readGroupRoleBatchItem)
      const timestamp = deps.now()
      const { store, result } = await mutateStore(store => createGroupRolesBatch(store, chatId, items, () => deps.newId('role'), timestamp))
      deps.log.info('role-create-batch:stored', {
        chatId,
        roleIds: result.map(role => role.id),
        templateIds: result.map(role => role.templateId).filter(Boolean),
        itemCount: result.length,
        source: getBatchSource(items),
      })
      await deps.broadcastStoreUpdated(store)
      return { ok: true, roles: result, store }
    } catch (error) {
      deps.log.warn('role-create-batch:failed', { chatId, itemCount: rawItems.length, source: getRawBatchSource(rawItems), error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  }

  const handleRoleUpdate = async (message: RuntimeMessage) => {
    const patch = isRecord(message.patch) ? message.patch : message
    const roleId = requireString(message.roleId, '缺少人员 ID')
    const { store, result } = await mutateStore(store => {
      const role = store.rolesById[roleId]
      const previousChatSite = role?.chatSite
      const updatedRole = updateGroupRole(store, roleId, {
        name: readOptionalString(patch.name),
        description: readOptionalString(patch.description),
        systemPrompt: readOptionalString(patch.systemPrompt),
        avatarColor: readOptionalString(patch.avatarColor),
        modelSource: readModelSource(patch.modelSource),
        chatSite: readChatSite(patch.chatSite),
        externalModelId: readOptionalString(patch.externalModelId),
        chatGptGptsUrl: readOptionalString(patch.chatGptGptsUrl),
        grokProjectUrl: readOptionalString(patch.grokProjectUrl),
      }, deps.now())
      const siteChanged = previousChatSite !== updatedRole.chatSite
      if (siteChanged) deps.runtimeFrames.removeRole(updatedRole.chatId, updatedRole.id)
      return { role: updatedRole, siteChanged }
    })
    await deps.broadcastStoreUpdated(store)
    return { ok: true, role: result.role, siteChanged: result.siteChanged, store }
  }

  const handleRoleDelete = async (message: RuntimeMessage) => {
    const roleId = requireString(message.roleId, '缺少人员 ID')
    const result = await mutateStore(store => {
      const role = store.rolesById[roleId]
      if (!role) throw new Error(`找不到人员：${roleId}`)
      const chatId = role.chatId
      if (Object.values(store.projectsById ?? {}).some(project => project.chatId === chatId && project.status !== 'draft' && project.status !== 'completed' && [project.managerRoleId, project.reviewerRoleId, ...project.engineers.map(item => item.roleId)].includes(roleId))) throw new Error('An unfinished project owns this role; reconcile it before deleting source identity')
      deleteGroupRole(store, roleId, deps.now())
      deps.runtimeFrames.removeRole(chatId, roleId)
      return { chatId, roleId }
    })
    deps.log.info('role-delete:stored', { chatId: result.result.chatId, roleId: result.result.roleId })
    await deps.broadcastStoreUpdated(result.store)
    return { ok: true, store: result.store }
  }

  const handleRoleRecover = async (message: RuntimeMessage) => {
    deps.log.info('role-recover:start', { chatId: message.chatId, roleId: message.roleId, hostTabId: message.hostTabId })
    const { store, result } = await mutateStore(store => {
      const chat = requireChat(store, message.chatId)
      const role = requireRole(store, chat.id, message.roleId)
      const wasThinking = role.status === 'thinking'
      const wasStopped = role.status === 'stopped'
      role.status = 'loading'
      if (wasThinking && role.lastPromptMessageId) role.replyAttemptId = deps.newId('attempt')
      if (wasStopped) {
        delete role.lastPromptMessageId
        delete role.replyAttemptId
      }
      role.updatedAt = deps.now()
      chat.status = 'initializing'
      chat.updatedAt = role.updatedAt
      return { role, iframeSrc: normalizeSupportedChatConversationUrl(role.geminiConversationUrl) ?? getDefaultChatSiteUrlForRole(role, store.settings.defaultChatSite) }
    })
    deps.log.info('role-recover:ready', { roleId: result.role.id, roleName: result.role.name, iframeSrc: result.iframeSrc, status: result.role.status })
    await deps.broadcastStoreUpdated(store)
    return { ok: true, ...result, store }
  }


  // Rotate only an idle, specifically exhausted ChatGPT conversation. Any in-flight
  // task must be independently reconciled; never replay a possibly applied action.
  const handleRoleChatHandoff = async (message: RuntimeMessage) => {
    const chatId = requireString(message.chatId, 'Eksik sohbet kimliği')
    const roleId = requireString(message.roleId, 'Eksik personel kimliği')
    const timestamp = deps.now()
    const { store, result } = await mutateStore(store => {
      const chat = requireChat(store, chatId)
      const role = requireRole(store, chat.id, roleId)
      if (role.modelSource === 'external' || role.chatSite !== 'chatgpt') throw new Error('Yalnız ChatGPT web sohbeti devredilebilir')
      if (role.siteHealth?.status !== 'blocked' || role.siteHealth.detail !== 'CONVERSATION_EXHAUSTED') {
        throw new Error('Doğrulanmış sohbet uzunluğu sınırı yok')
      }
      if (role.conversationHandoff && role.conversationHandoff.phase !== 'verified') throw new Error('Bu personel için devir zaten kaydedilmiş')
      if (role.status === 'thinking' || role.lastPromptMessageId ||
          chat.messageIds.some(id => {
            const status = store.messagesById[id]?.deliveryStatus?.[role.id]
            return status === 'pending' || status === 'sent'
          })) throw new Error('Aktif veya belirsiz görev; otomatik devir engellendi')
      const checkpoint = buildHandoffCheckpoint(store, chat, role)
      if (!checkpoint.oldConversationUrl) throw new Error('Eski sohbet bağlantısı doğrulanamıyor; devir engellendi')
      role.conversationHandoff = {
        phase: 'rotating',
        startedAt: timestamp,
        previousConversationUrl: checkpoint.oldConversationUrl,
        previousMessageId: checkpoint.pendingMessageId,
        checkpointSeq: checkpoint.lastMessageSeq,
        checkpointHistory: checkpoint.history,
      }
      delete role.geminiConversationUrl
      delete role.geminiConversationId
      delete role.siteHealth
      role.contextCursor = checkpoint.lastMessageSeq
      role.status = 'loading'
      role.updatedAt = timestamp
      chat.status = 'initializing'
      chat.updatedAt = timestamp
      return checkpoint
    })
    deps.runtimeFrames.removeRole(chatId, roleId)
    await deps.broadcastStoreUpdated(store)
    return { ok: true, checkpoint: result, store }
  }

  const handleRoleChatHandoffVerify = async (message: RuntimeMessage) => {
    const chatId = requireString(message.chatId, 'Eksik sohbet kimliği')
    const roleId = requireString(message.roleId, 'Eksik personel kimliği')
    const { store, result } = await mutateStore(store => {
      const chat = requireChat(store, chatId)
      const role = requireRole(store, chat.id, roleId)
      const handoff = role.conversationHandoff
      if (!handoff || (handoff.phase !== 'rotating' && handoff.phase !== 'initializing')) {
        throw new Error('Doğrulanacak aktif devir bulunamadı')
      }
      const currentId = extractSupportedConversationId(role.geminiConversationUrl)
      const previousId = extractSupportedConversationId(handoff.previousConversationUrl)
      const acknowledgement = chat.messageIds
        .map(id => store.messagesById[id])
        .find(reply => reply?.type === 'assistant' && reply.roleId === role.id &&
          reply.sourceMessageId === handoff.initMessageId && reply.content.trim() === 'HAZIR_DEVIR')
      if (role.status !== 'ready' || role.siteHealth?.status === 'blocked' ||
          !currentId || !previousId || currentId === previousId ||
          !handoff.initMessageId || !acknowledgement || acknowledgement.createdAt < handoff.startedAt) {
        throw new Error('Yeni sohbetin kimliği ve HAZIR_DEVIR yanıtı henüz doğrulanmadı')
      }
      role.conversationHandoff = { ...handoff, phase: 'verified' }
      role.updatedAt = deps.now()
      chat.updatedAt = role.updatedAt
      return role
    })
    await deps.broadcastStoreUpdated(store)
    return { ok: true, role: result, store }
  }

  const handleRoleChatHandoffFail = async (message: RuntimeMessage) => {
    const chatId = requireString(message.chatId, 'Eksik sohbet kimliği')
    const roleId = requireString(message.roleId, 'Eksik personel kimliği')
    const { store, result } = await mutateStore(store => {
      const chat = requireChat(store, chatId)
      const role = requireRole(store, chat.id, roleId)
      if (!role.conversationHandoff || role.conversationHandoff.phase === 'verified') throw new Error('Bekleyen devir bulunamadı')
      role.conversationHandoff = { ...role.conversationHandoff, phase: 'blocked' }
      role.status = 'error'
      role.updatedAt = deps.now()
      chat.updatedAt = role.updatedAt
      return role
    })
    await deps.broadcastStoreUpdated(store)
    return { ok: true, role: result, store }
  }

  const handleRoleReinitialize = async (message: RuntimeMessage) => {
    const chatId = requireString(message.chatId, '缺少群聊 ID')
    const roleId = requireString(message.roleId, '缺少人员 ID')
    const binding = deps.runtimeFrames.getByRole(chatId, roleId)
    deps.log.info('role-reinitialize:start', { chatId, roleId, binding })
    if (!binding?.ready) throw new Error('人员 iframe 尚未就绪，请先恢复人员')

    const timestamp = deps.now()
    const { store, result } = await mutateStore(store => {
      const chat = requireChat(store, chatId)
      const role = requireRole(store, chat.id, roleId)
      const roles = getChatRoles(store, chat)
      if (role.status !== 'ready') throw new Error(`人员不可用：${role.name}`)

      const messageId = deps.newId('init')
      const replyAttemptId = deps.newId('attempt')
      const includesPersona = !roleUsesChatGptGptsPersona(role)
      if (role.conversationHandoff?.phase === 'rotating') {
        role.conversationHandoff.phase = 'initializing'
        role.conversationHandoff.initMessageId = messageId
      }
      role.status = 'thinking'
      role.lastPromptMessageId = messageId
      role.replyAttemptId = replyAttemptId
      role.updatedAt = timestamp
      chat.status = 'running'
      chat.updatedAt = timestamp

      return {
        delivery: {
          roleId,
          tabId: binding.tabId,
          frameId: binding.frameId,
          message: {
            type: 'TEAM_SEND_PROMPT' as const,
            chatId,
            roleId,
            messageId,
            replyAttemptId,
            content: role.conversationHandoff?.phase === 'initializing'
              ? buildReinitPrompt(chat, role, roles, true, store.settings.language) + '\n\n' +
                buildHandoffResumePrompt({
                  chatId: chat.id,
                  roleId: role.id,
                  roleName: role.name,
                  oldConversationUrl: role.conversationHandoff.previousConversationUrl,
                  pendingMessageId: role.conversationHandoff.previousMessageId,
                  lastMessageSeq: role.conversationHandoff.checkpointSeq,
                  history: role.conversationHandoff.checkpointHistory,
                })
              : buildReinitPrompt(chat, role, roles, includesPersona, store.settings.language),
            includesPersona: role.conversationHandoff?.phase === 'initializing' ? true : includesPersona,
          },
        },
      }
    })

    deps.log.info('role-reinitialize:deliver', {
      chatId,
      roleId,
      messageId: result.delivery.message.messageId,
      tabId: result.delivery.tabId,
      frameId: result.delivery.frameId,
      contentLength: result.delivery.message.content.length,
    })
    await deps.broadcastStoreUpdated(store)
    await deps.sendPrompt(result.delivery)
    return { ok: true, store, messageId: result.delivery.message.messageId }
  }

  return [
    { type: 'ROLE_TEMPLATE_PERSONA_GENERATE', handler: handleRoleTemplatePersonaGenerate },
    { type: 'ROLE_TEMPLATE_CREATE', handler: handleRoleTemplateCreate },
    { type: 'ROLE_TEMPLATE_UPDATE', handler: handleRoleTemplateUpdate },
    { type: 'ROLE_TEMPLATE_DELETE', handler: handleRoleTemplateDelete },
    { type: 'GROUP_ROLE_CREATE', handler: handleRoleCreate },
    { type: 'GROUP_ROLES_CREATE_BATCH', handler: handleRolesCreateBatch },
    { type: 'GROUP_ROLE_UPDATE', handler: handleRoleUpdate },
    { type: 'GROUP_ROLE_DELETE', handler: handleRoleDelete },
    { type: 'GROUP_ROLE_RECOVER', handler: handleRoleRecover },
    { type: 'GROUP_ROLE_REINITIALIZE', handler: handleRoleReinitialize },
    { type: 'GROUP_ROLE_CHAT_HANDOFF', handler: handleRoleChatHandoff },
    { type: 'GROUP_ROLE_CHAT_HANDOFF_VERIFY', handler: handleRoleChatHandoffVerify },
    { type: 'GROUP_ROLE_CHAT_HANDOFF_FAIL', handler: handleRoleChatHandoffFail },
  ]
}

function readGroupRoleBatchItem(value: unknown): Parameters<typeof createGroupRolesBatch>[2][number] {
  if (!isRecord(value)) throw new Error('添加人员项无效')
  const chatSite = readChatSite(value.chatSite)

  if (value.source === 'library') {
    return {
      source: 'library',
      roleTemplateId: requireString(value.roleTemplateId ?? value.templateId, '缺少人员库 ID'),
      modelSource: readModelSource(value.modelSource),
      chatSite,
      externalModelId: readOptionalString(value.externalModelId),
      avatarColor: readOptionalString(value.avatarColor),
    }
  }

  if (value.source === 'temporary') {
    return {
      source: 'temporary',
      name: requireString(value.name, '人员名称不能为空'),
      createdBy: readRoleCreatedBy(value.createdBy),
      description: readOptionalString(value.description),
      systemPrompt: readOptionalString(value.systemPrompt) ?? '',
      modelSource: readModelSource(value.modelSource),
      chatSite,
      externalModelId: readOptionalString(value.externalModelId),
      avatarColor: readOptionalString(value.avatarColor),
    }
  }

  throw new Error('添加人员来源无效')
}

function readRoleCreatedBy(value: unknown): Parameters<typeof createGroupRole>[1]['createdBy'] {
  return value === 'orchestration-auto' || value === 'orchestration-template' ? value : undefined
}

function getBatchSource(items: Parameters<typeof createGroupRolesBatch>[2]): 'library' | 'temporary' | 'mixed' {
  const sources = new Set(items.map(item => item.source))
  if (sources.size === 1) return items[0]?.source ?? 'mixed'
  return 'mixed'
}

function getRawBatchSource(items: unknown[]): 'library' | 'temporary' | 'mixed' {
  const sources = new Set(items.map(item => (isRecord(item) && (item.source === 'library' || item.source === 'temporary')) ? item.source : 'mixed'))
  if (sources.size === 1) return sources.values().next().value as 'library' | 'temporary' | 'mixed'
  return 'mixed'
}

function readChatSite(value: unknown): ChatSite | undefined {
  return value === 'chatgpt' || value === 'claude' || value === 'gemini' || value === 'deepseek' || value === 'grok' ? value : undefined
}

function readModelSource(value: unknown): 'site' | 'external' | undefined {
  return value === 'site' || value === 'external' ? value : undefined
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() || undefined : undefined
}

function requireString(value: unknown, error: string): string {
  const result = readOptionalString(value)
  if (!result) throw new Error(error)
  return result
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
