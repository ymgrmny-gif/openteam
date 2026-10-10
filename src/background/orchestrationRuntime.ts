import { buildOrchestrationReviewMessageContent, buildOrchestrationRoleMessageContent } from '../group/orchestrationPrompts'
import { parseReviewDecision } from '../group/orchestrationReview'
import { validateArtifact, validateReadiness } from '../group/projectExecutionGate'
import { applyManagerBreakdown } from '../group/projectWorkspace'
import {
  DEFAULT_ORCHESTRATION_MAX_NODE_EXECUTIONS,
  DEFAULT_ORCHESTRATION_REVIEW_MAX_ATTEMPTS,
  MAX_ORCHESTRATION_MAX_NODE_EXECUTIONS,
  type GroupChat,
  type GroupMessage,
  type OpenTeamStore,
  type OrchestrationFlow,
  type OrchestrationGraphSnapshot,
  type OrchestrationReviewResult,
  type OrchestrationRun,
  type OrchestrationStage,
  type OrchestrationStageRun,
  type OrchestrationStepStatus,
} from '../group/types'
import type { ExternalModelClient } from './externalModelClient'
import type { PromptDelivery, PromptSender } from './promptDelivery'
import { DEFAULT_PROMPT_DELIVERY_RETRY_DELAYS_MS, sendPromptDeliveryWithRetry } from './promptDeliveryRetry'
import { isExternalModelRole, prepareRolePromptDelivery, type ExternalPromptDelivery } from './rolePromptDelivery'
import type { RuntimeFrameRegistry } from './runtimeFrames'
import type { SitePromptDeliveryLimiter } from './sitePromptDeliveryLimiter'
import { getChatMessages, getChatRoles, mutateStore, requireChat, requireRole } from './storeAccess'

const ORCHESTRATION_STALE_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes

export interface OrchestrationRuntimeDependencies {
  broadcastStoreUpdated(store: OpenTeamStore, excludeTabId?: number): Promise<void> | void
  getChatStatusFromRoles(store: OpenTeamStore, chat: GroupChat): GroupChat['status']
  log: {
    info(event: string, details?: Record<string, unknown>): void
    warn(event: string, details?: Record<string, unknown>): void
  }
  newId(prefix: string): string
  now(): number
  runtimeFrames: Pick<RuntimeFrameRegistry, 'getByRole'>
  sendPrompt: PromptSender
  promptDeliveryLimiter?: SitePromptDeliveryLimiter
  externalModelClient?: ExternalModelClient
  deliveryRetryDelaysMs?: readonly number[]
  requestRoleRecovery?(chatId: string, roleId: string, reason?: string): Promise<boolean>
  waitForRetry?(ms: number): Promise<void>
}

export interface TestRunTrace {
  runId: string
  task: string
  stages: Array<{
    stageId: string
    stageIndex: number
    name: string
    roleResults: Array<{
      roleId: string
      roleName: string
      input: string
      output: string
      status: OrchestrationStepStatus
    }>
    status: OrchestrationStepStatus
  }>
  totalDurationMs: number
  error?: string
}

interface StartStageResult {
  store: OpenTeamStore
  deliveries: PromptDelivery[]
  externalDeliveries: ExternalPromptDelivery[]
  retry?: StartStagePreparationRetry
}

type NextStageDecision = { next: true; runId: string; stageIndices: number[] } | { next: false }

interface StartStagePreparationRetry {
  chatId: string
  roleId: string
  roleName: string
  delayMs: number
  retryCount: number
  reason: string
}

export async function startOrchestrationRun(deps: OrchestrationRuntimeDependencies, input: { chatId: string; flowId: string; task: string; maxRounds?: number; maxNodeExecutions?: number }, isTest = false): Promise<{ store: OpenTeamStore; run: OrchestrationRun }> {
  const timestamp = deps.now()
  const { store, result } = await mutateStore(store => {
    const chat = requireChat(store, input.chatId)
    const flow = requireFlow(store, chat.id, input.flowId)
    validateExecutableFlow(store, chat, flow)
    for (const workspace of Object.values(store.projectsById ?? {})) {
      if (workspace.status === 'draft' || workspace.status === 'completed' || flow.project?.workspaceId === workspace.id) continue
      if (workspace.chatId === chat.id || flow.project?.tasks.some(task => workspace.engineers.some(owner => owner.worktree.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase() === task.worktree.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase() || owner.branch.toLowerCase() === task.branch.toLowerCase()))) throw new Error('Project workspace owns this chat, branch or worktree')
    }
    if (flow.project) {
      const previous = Object.values(store.orchestrationRunsById).find(run => run.chatId === chat.id && run.flowSnapshot?.project?.id === flow.project?.id)
      if (previous) {
        if (JSON.stringify(previous.flowSnapshot?.project) !== JSON.stringify(flow.project)) throw new Error('Project id already belongs to a different backlog')
        return { run: previous, stageIndices: [] }
      }
      if (getChatRoles(store, chat).some(role => role.status === 'thinking' || role.lastPromptMessageId)) throw new Error('BLOCKED: chat has an in-flight or uncertain role prompt')
      const resourceKey = (path: string) => path.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()
      for (const other of Object.values(store.orchestrationRunsById)) {
        const project = other.flowSnapshot?.project
        if (!project || other.status === 'completed') continue
        if (other.chatId === chat.id || project.tasks.some(task => flow.project!.tasks.some(next => resourceKey(next.worktree) === resourceKey(task.worktree) || next.branch.toLowerCase() === task.branch.toLowerCase()))) throw new Error('BLOCKED: another unfinished project owns this chat, branch or worktree; reconcile it first')
      }
    }
    if (Object.values(store.orchestrationRunsById).some(run => run.chatId === chat.id && run.flowSnapshot?.project && run.status !== 'completed')) throw new Error('An unfinished project owns this chat; use a separate chat for unrelated orchestration')
    if (!isTest) {
      const activeRunId = store.activeOrchestrationRunIdByChatId[chat.id]
      const activeRun = activeRunId ? store.orchestrationRunsById[activeRunId] : undefined
      if (activeRun && activeRun.status === 'pending') throw new Error('该群聊已有运行中的编排')
      if (activeRun && activeRun.status === 'running') {
        if (activeRun.flowSnapshot?.project) throw new Error('Project already owns this chat')
        if (hasLiveRunningRolePrompt(store, chat, activeRun)) throw new Error('该群聊已有运行中的编排')
        stopStaleActiveRun(store, chat, activeRun, timestamp)
      }
      if (activeRunId && !activeRun) delete store.activeOrchestrationRunIdByChatId[chat.id]
    }

    const maxNodeExecutions = normalizeMaxNodeExecutions(input.maxNodeExecutions ?? flow.maxNodeExecutions)
    const taskMessage: GroupMessage = {
      id: deps.newId('msg'),
      chatId: chat.id,
      seq: chat.nextMessageSeq,
      type: 'user',
      content: input.task.trim(),
      targetRoleIds: [],
      mentionedRoleIds: [],
      mentionsAll: false,
      orchestrationKind: 'task',
      createdAt: timestamp,
      status: 'received',
    }
    if (!taskMessage.content) throw new Error('编排任务不能为空')

    const run: OrchestrationRun = {
      id: deps.newId('run'),
      chatId: chat.id,
      flowId: flow.id,
      status: 'pending',
      currentRound: 1,
      maxNodeExecutions,
      maxRounds: maxNodeExecutions,
      stageRuns: [],
      createdAt: timestamp,
      updatedAt: timestamp,
      flowSnapshot: structuredClone(flow),
      pendingStageIndices: rootStageIndices(flow),
    }
    taskMessage.orchestrationRunId = run.id
    taskMessage.orchestrationRound = 1

    store.messagesById[taskMessage.id] = taskMessage
    chat.messageIds.push(taskMessage.id)
    chat.nextMessageSeq += 1
    store.orchestrationRunsById[run.id] = run
    if (!isTest) {
      store.activeOrchestrationRunIdByChatId[chat.id] = run.id
      chat.status = 'running'
    }
    chat.updatedAt = timestamp
    return { run, stageIndices: rootStageIndices(flow) }
  })

  if (!isTest) await deps.broadcastStoreUpdated(store)
  await startStages(deps, result.run.id, result.stageIndices)
  const latest = await mutateStore(store => store.orchestrationRunsById[result.run.id])
  return { store: latest.store, run: latest.result }
}

export async function stopOrchestrationRun(deps: OrchestrationRuntimeDependencies, chatId: string): Promise<{ store: OpenTeamStore; run?: OrchestrationRun }> {
  const timestamp = deps.now()
  const active = await mutateStore(store => {
    const chat = requireChat(store, chatId)
    const runId = store.activeOrchestrationRunIdByChatId[chat.id]
    const run = runId ? store.orchestrationRunsById[runId] : undefined
    if (!run) return undefined
    if (run.flowSnapshot?.project) {
      if (run.status === 'error') throw new Error('Blocked project requires source reconciliation; pause cannot clear its error')
      run.status = 'stopped'
      run.updatedAt = timestamp
      // Keep the lease and original correlation: an in-flight writer may finish.
      // Pausing prevents subsequent dispatch, it does not cancel external tools.
      chat.updatedAt = timestamp
      return run
    }
    run.status = 'stopped'
    run.updatedAt = timestamp
    run.completedAt = timestamp
    for (const stageRun of run.stageRuns) {
      if (stageRun.status === 'running' || stageRun.status === 'pending' || stageRun.status === 'error') {
        stageRun.status = 'skipped'
        stageRun.completedAt = timestamp
        for (const roleRun of Object.values(stageRun.roleRuns)) {
          if (roleRun.status === 'running' || roleRun.status === 'pending' || roleRun.status === 'error') {
            roleRun.status = 'skipped'
            roleRun.completedAt = timestamp
          }
        }
      }
    }
    delete store.activeOrchestrationRunIdByChatId[chat.id]
    for (const role of getChatRoles(store, chat)) {
      if (role.status === 'thinking') {
        role.status = 'stopped'
        delete role.lastPromptMessageId
        delete role.replyAttemptId
        role.updatedAt = timestamp
      }
    }
    chat.status = deps.getChatStatusFromRoles(store, chat)
    chat.updatedAt = timestamp
    return run
  })
  await deps.broadcastStoreUpdated(active.store)
  return { store: active.store, run: active.result }
}

export async function detectAndHandleStaleRuns(deps: OrchestrationRuntimeDependencies, checkpointedOnly = false): Promise<void> {
  const timestamp = deps.now()
  const { store, result: staleRunIds } = await mutateStore(store => {
    const stale = Object.values(store.orchestrationRunsById).filter(run => {
      return (!checkpointedOnly || Boolean(run.flowSnapshot)) && (run.status === 'running' || run.status === 'pending') && (timestamp - run.updatedAt) > ORCHESTRATION_STALE_TIMEOUT_MS
    })
    for (const run of stale) {
      run.status = 'error'
      run.error = run.flowSnapshot?.project
        ? 'BLOCKED: source completion deadline expired; delivery may have executed. Reconcile original source, never resend.'
        : `编排运行超时，已自动标记为失败 (最后更新于 ${new Date(run.updatedAt).toLocaleTimeString()})`
      run.completedAt = timestamp
      run.updatedAt = timestamp
      const chat = store.chatsById[run.chatId]
      if (chat) {
        if (store.activeOrchestrationRunIdByChatId[chat.id] === run.id) {
          delete store.activeOrchestrationRunIdByChatId[chat.id]
        }
        chat.status = 'error'
        chat.updatedAt = timestamp
      }
    }
    return stale.map(r => r.id)
  })

  if (staleRunIds.length > 0) {
    deps.log.warn('orchestration-runtime:stale-runs-handled', { count: staleRunIds.length, runIds: staleRunIds })
    await deps.broadcastStoreUpdated(store)
  }
}

// A wakeup reconciles committed replies and transitions, never replays an
// uncertain send. The running roleRun is the durable single-writer lease.
export async function recoverOrchestrationRuns(deps: OrchestrationRuntimeDependencies): Promise<void> {
  const snapshot = await mutateStore(store => Object.values(store.orchestrationRunsById)
    .filter(run => (run.status === 'running' || run.status === 'pending') && store.activeOrchestrationRunIdByChatId[run.chatId] === run.id)
    .map(run => ({ id: run.id, chatId: run.chatId, pending: run.pendingStageIndices ?? [], replies: run.stageRuns.flatMap(sr => Object.values(sr.roleRuns)
      .filter(rr => sr.status === 'running' && rr.status === 'running')
      .flatMap(rr => {
        const reply = Object.values(store.messagesById).find(msg => msg.chatId === run.chatId && msg.type === 'assistant' && msg.roleId === rr.roleId && msg.sourceMessageId === rr.messageId && msg.status === 'received')
        return reply ? [{ roleId: rr.roleId, promptMessageId: rr.messageId, replyMessage: reply }] : []
      })) })))
  for (const run of snapshot.result) {
    for (const reply of run.replies) await maybeAdvanceOrchestrationRun(deps, { chatId: run.chatId, ...reply })
    await startStages(deps, run.id, run.pending)
  }
  await detectAndHandleStaleRuns(deps, true)
}

// Recovery is limited to a proven unsent initial checkpoint. A persisted
// stage/prompt, uncertain delivery or any other block remains non-replayable.
export function canResumeUnsentProjectRun(store: OpenTeamStore, run: OrchestrationRun, deps: OrchestrationRuntimeDependencies): boolean {
  const flow = run.flowSnapshot
  const chat = store.chatsById[run.chatId]
  if (!chat || !flow?.project || run.status !== 'error' || !run.error?.startsWith('BLOCKED: ') || !run.error.endsWith('人员 iframe 尚未就绪，请先恢复人员') || run.stageRuns.length || (run.preflightResumeCount ?? 0) >= 3 || JSON.stringify(run.pendingStageIndices) !== JSON.stringify(rootStageIndices(flow))) return false
  if (getChatMessages(store, chat).some(message => message.orchestrationRunId === run.id && message.orchestrationKind !== 'task')) return false
  const active = store.orchestrationRunsById[store.activeOrchestrationRunIdByChatId[chat.id]]
  if (active && active.id !== run.id && active.status !== 'completed') return false
  const targets = rootStageIndices(flow).flatMap(index => targetRoleIdsForStage(flow.stages[index]))
  return targets.length > 0 && targets.every(id => {
    const role = store.rolesById[id]
    return role && role.status === 'ready' && !role.lastPromptMessageId && role.siteHealth?.status !== 'blocked' && role.siteHealth?.status !== 'unauthorized'
  }) && !findLocalRoleFrameBlocker(store, chat, targets, deps)
}

export async function resumeOrchestrationRun(deps: OrchestrationRuntimeDependencies, input: { chatId: string; runId?: string }): Promise<{ store: OpenTeamStore; run: OrchestrationRun }> {
  const timestamp = deps.now()
  const prepared = await mutateStore(store => {
    const chat = requireChat(store, input.chatId)
    const run = findResumableRun(store, chat, input.runId)
    if (!run) throw new Error('找不到可继续的编排')
    if (run.status !== 'stopped') {
      if (!canResumeUnsentProjectRun(store, run, deps)) throw new Error('只有已停止的编排可以继续')
      run.preflightResumeCount = (run.preflightResumeCount ?? 0) + 1
    }
    const flow = run.flowSnapshot ?? requireFlow(store, chat.id, run.flowId)
    validateExecutableFlow(store, chat, flow)
    const last = currentStageRun(run)
    run.status = 'running'
    delete run.completedAt
    delete run.error
    run.updatedAt = timestamp
    store.activeOrchestrationRunIdByChatId[chat.id] = run.id
    chat.status = 'running'
    chat.updatedAt = timestamp
    if (run.flowSnapshot?.project) return { run, stageIndices: run.pendingStageIndices ?? [] }
    if (!last) {
      run.pendingStageIndices = rootStageIndices(flow)
      return { run, stageIndices: run.pendingStageIndices }
    }
    if (last.status === 'skipped' || last.status === 'error' || last.status === 'pending' || last.status === 'running') {
      removeStageRunAndFollowing(run, last)
      run.pendingStageIndices = [last.stageIndex]
      return { run, stageIndices: [last.stageIndex] }
    }
    const next = nextStageDecision(store, chat, run, last, timestamp)
    return { run, stageIndices: next.next ? next.stageIndices : [] }
  })
  await deps.broadcastStoreUpdated(prepared.store)
  if (prepared.result.stageIndices.length > 0) await startStages(deps, prepared.result.run.id, prepared.result.stageIndices)
  if (prepared.result.run.flowSnapshot?.project) await recoverOrchestrationRuns(deps)
  const latest = await mutateStore(store => store.orchestrationRunsById[prepared.result.run.id])
  return { store: latest.store, run: latest.result }
}

export async function maybeAdvanceOrchestrationRun(deps: OrchestrationRuntimeDependencies, input: { chatId: string; roleId: string; promptMessageId?: string; replyMessage?: GroupMessage }): Promise<OpenTeamStore | undefined> {
  if (!input.promptMessageId) return undefined
  const promptMessageId = input.promptMessageId
  const timestamp = deps.now()
  const advance = await mutateStore(store => {
    const chat = requireChat(store, input.chatId)
    const activeRunId = store.activeOrchestrationRunIdByChatId[chat.id]
    const run = activeRunId ? store.orchestrationRunsById[activeRunId] : undefined
    if (!run || run.status !== 'running') return { next: false as const }
    const stageRun = findRunningStageRunForRolePrompt(run, input.roleId, promptMessageId)
    if (!stageRun || stageRun.status !== 'running') return { next: false as const }
    const roleRun = stageRun.roleRuns[input.roleId]
    if (!roleRun || roleRun.messageId !== promptMessageId || roleRun.status !== 'running') return { next: false as const }
    const flow = run.flowSnapshot ?? requireFlow(store, chat.id, run.flowId)
    if (flow.project) {
      const reply = input.replyMessage && store.messagesById[input.replyMessage.id]
      const prompt = store.messagesById[promptMessageId]
      if (!reply || reply.type !== 'assistant' || reply.chatId !== chat.id || reply.roleId !== input.roleId || reply.sourceMessageId !== promptMessageId || reply.status !== 'received' || !reply.content.trim() || !prompt || reply.createdAt < prompt.createdAt || prompt.deliveryStatus?.[input.roleId] !== 'received') return { next: false as const }
      input.replyMessage = reply
      try {
        const result = JSON.parse(reply.content.replace(/^```(?:json)?\s*|\s*```$/g, ''))
        if (result.blocked === true) {
          failRun(store, chat, run, `BLOCKED: ${String(result.reason || 'Role requires user action')}`, timestamp)
          return { next: false as const }
        }
      } catch { /* Non-JSON worker delivery is permitted; review still gates acceptance. */ }
      if (stageRun.kind === 'review') {
        const parsed = parseReviewDecision(reply.content)
        if (parsed.ok && parsed.decision.decision === 'pass') {
          const evidence = JSON.parse(parsed.decision.rawJson) as Record<string, unknown>
          const stage = flow.stages[stageRun.stageIndex]
          const taskId = stage?.projectTaskId
          const task = flow.project.tasks.find(item => item.id === taskId)!
          if (stage.projectGate) {
            const managerStage = [...run.stageRuns].reverse().find(sr => flow.stages[sr.stageIndex]?.projectTaskId === taskId && flow.stages[sr.stageIndex]?.name.endsWith(': Manager'))
            const managerPromptId = managerStage?.roleRuns[flow.project.managerRoleId]?.messageId
            const managerReply = getChatMessages(store, chat).find(msg => msg.type === 'assistant' && msg.sourceMessageId === managerPromptId && msg.roleId === flow.project!.managerRoleId && msg.status === 'received')
            try {
              if (!managerReply || evidence.taskId !== taskId || evidence.planMessageId !== managerReply.id || evidence.verified !== true || !Array.isArray(evidence.evidence) || !evidence.evidence.length || evidence.evidence.some(item => typeof item !== 'string' || !item.trim()) || parsed.decision.failedCriteria.length) throw new Error('Review gate lacks exact correlated independent evidence')
              if (stage.projectGate === 'readiness') validateReadiness(evidence, task)
              else {
                if (evidence.coverageVerified !== true) throw new Error('Original plan acceptance coverage is unverified')
                const project = store.projectsById?.[flow.project.workspaceId!]
                const node = project?.nodes.find(item => item.id === taskId)
                if (!project || !node) throw new Error('Planning workspace missing')
                const candidate = structuredClone(project)
                applyManagerBreakdown(candidate, candidate.nodes.find(item => item.id === node.id)!, managerReply.content, timestamp)
              }
            } catch (error) {
              failRun(store, chat, run, `BLOCKED: ${error instanceof Error ? error.message : String(error)}`, timestamp)
              return { next: false as const }
            }
          } else {
            const workerStage = [...run.stageRuns].reverse().find(sr => flow.stages[sr.stageIndex]?.projectTaskId === taskId && flow.stages[sr.stageIndex]?.name.endsWith(': Worker'))
            const workerPromptId = workerStage && Object.values(workerStage.roleRuns)[0]?.messageId
            const workerReply = getChatMessages(store, chat).find(msg => msg.type === 'assistant' && msg.sourceMessageId === workerPromptId && msg.roleId === flow.project?.tasks.find(task => task.id === taskId)?.ownerRoleId && msg.status === 'received')
            if (!workerReply || evidence.taskId !== taskId || evidence.workerMessageId !== workerReply.id || evidence.verified !== true || !Array.isArray(evidence.evidence) || !evidence.evidence.length || evidence.evidence.some(item => typeof item !== 'string' || !item.trim()) || parsed.decision.failedCriteria.length) {
              failRun(store, chat, run, 'BLOCKED: review PASS lacks correlated independent source/test/Git evidence', timestamp)
              return { next: false as const }
            }
            if (task.execution) {
              try { validateArtifact(evidence, task) } catch (error) {
                failRun(store, chat, run, `BLOCKED: ${error instanceof Error ? error.message : String(error)}`, timestamp)
                return { next: false as const }
              }
            }
          }
        }
      }
    }
    if (input.replyMessage) {
      const persistedReply = store.messagesById[input.replyMessage.id]
      if (persistedReply) {
        persistedReply.orchestrationRunId = run.id
        persistedReply.orchestrationRound = stageRun.round
        persistedReply.orchestrationStageId = stageRun.stageId
        persistedReply.orchestrationStageIndex = stageRun.stageIndex
      }
    }

    roleRun.status = 'completed'
    roleRun.completedAt = timestamp
    run.updatedAt = timestamp

    if (stageRun.kind === 'review') {
      const reply = input.replyMessage
      if (!reply) return { next: false as const }
      const parsed = parseReviewDecision(reply.content)
      if (!parsed.ok) {
        roleRun.status = 'error'
        roleRun.error = parsed.error
        stageRun.status = 'error'
        run.status = 'error'
        run.error = parsed.error
        run.updatedAt = timestamp
        chat.status = 'error'
        chat.updatedAt = timestamp
        return { next: false as const }
      }
      stageRun.reviewResults ??= []
      stageRun.reviewResults.push({
        round: stageRun.round,
        stageRunId: stageRun.stageId,
        reviewerRoleId: input.roleId,
        messageId: reply.id,
        ...parsed.decision,
        createdAt: timestamp,
      })
      stageRun.status = 'completed'
      stageRun.completedAt = timestamp
      return applyReviewDecision(store, chat, run, stageRun, parsed.decision.decision, timestamp)
    }

    if (!allRoleRunsFinished(stageRun)) return { next: false as const }
    stageRun.status = 'completed'
    stageRun.completedAt = timestamp
    return nextStageDecision(store, chat, run, stageRun, timestamp)
  })

  await deps.broadcastStoreUpdated(advance.store)
  await deps.promptDeliveryLimiter?.complete(input.chatId, promptMessageId, input.roleId)
  if (advance.result.next) await startStages(deps, advance.result.runId, advance.result.stageIndices)
  return advance.store
}

export async function markOrchestrationRoleError(deps: OrchestrationRuntimeDependencies, input: { chatId: string; roleId: string; promptMessageId?: string; error: string }): Promise<OpenTeamStore | undefined> {
  if (!input.promptMessageId) {
    deps.log.warn('orchestration-diagnostic:role-error:missing-message-id', input)
    return undefined
  }
  const promptMessageId = input.promptMessageId
  const timestamp = deps.now()
  const { store, result } = await mutateStore(store => {
    const chat = requireChat(store, input.chatId)
    const activeRunId = store.activeOrchestrationRunIdByChatId[chat.id]
    const run = activeRunId ? store.orchestrationRunsById[activeRunId] : undefined
    if (!run || run.status !== 'running') return false
    const stageRun = findRunningStageRunForRolePrompt(run, input.roleId, promptMessageId)
    const roleRun = stageRun?.roleRuns[input.roleId]
    if (!stageRun || !roleRun || roleRun.messageId !== promptMessageId || roleRun.status !== 'running') return false
    roleRun.status = 'error'
    roleRun.error = input.error
    roleRun.completedAt = timestamp
    stageRun.status = 'error'
    run.status = 'error'
    run.error = input.error
    run.updatedAt = timestamp
    chat.status = 'error'
    chat.updatedAt = timestamp
    return true
  })
  deps.log.warn('orchestration-diagnostic:role-error:mark-result', {
    chatId: input.chatId,
    roleId: input.roleId,
    promptMessageId,
    error: input.error,
    marked: result,
  })
  if (result) {
    await deps.broadcastStoreUpdated(store)
    await deps.promptDeliveryLimiter?.complete(input.chatId, promptMessageId, input.roleId)
  }
  return result ? store : undefined
}

export async function retryOrchestrationStage(deps: OrchestrationRuntimeDependencies, chatId: string, stageId?: string): Promise<{ store: OpenTeamStore }> {
  const timestamp = deps.now()
  const prepared = await mutateStore(store => {
    const chat = requireChat(store, chatId)
    const run = requireActiveRun(store, chat)
    if (run.flowSnapshot?.project) throw new Error('BLOCKED: project delivery cannot be replayed; reconcile source evidence first')
    const restartingStageRun = findRestartingStageRun(run, stageId)
    if (restartingStageRun) return { runId: run.id, stageIndex: restartingStageRun.stageIndex, alreadyRestarting: true }
    const stageRun = findRetryableStageRun(run, stageId)
    if (!stageRun) throw new Error('找不到可重试的编排节点')
    removeStageRunsAfter(run, stageRun)
    markStageRunRestarting(stageRun, timestamp)
    run.pendingStageIndices = [stageRun.stageIndex]
    run.status = 'running'
    delete run.error
    delete run.completedAt
    run.updatedAt = timestamp
    chat.status = 'running'
    chat.updatedAt = timestamp
    return { runId: run.id, stageIndex: stageRun.stageIndex, alreadyRestarting: false }
  })
  if (prepared.result.alreadyRestarting) return { store: prepared.store }
  await deps.broadcastStoreUpdated(prepared.store)
  const started = await startStage(deps, prepared.result.runId, prepared.result.stageIndex)
  return { store: started.store }
}

export async function skipOrchestrationStage(deps: OrchestrationRuntimeDependencies, chatId: string, stageId?: string): Promise<{ store: OpenTeamStore }> {
  const timestamp = deps.now()
  const advance = await mutateStore(store => {
    const chat = requireChat(store, chatId)
    const run = requireActiveRun(store, chat)
    if (run.flowSnapshot?.project) throw new Error('Project acceptance stages cannot be skipped')
    const stageRun = findRetryableStageRun(run, stageId)
    if (!stageRun) throw new Error('找不到可跳过的编排节点')
    stageRun.status = 'skipped'
    stageRun.completedAt = timestamp
    for (const roleRun of Object.values(stageRun.roleRuns)) {
      if (roleRun.status !== 'completed') {
        roleRun.status = 'skipped'
        roleRun.completedAt = timestamp
      }
    }
    run.status = 'running'
    delete run.error
    run.updatedAt = timestamp
    return nextStageDecision(store, chat, run, stageRun, timestamp)
  })
  await deps.broadcastStoreUpdated(advance.store)
  if (advance.result.next) await startStages(deps, advance.result.runId, advance.result.stageIndices)
  return { store: advance.store }
}

export async function retryOrchestrationReview(deps: OrchestrationRuntimeDependencies, chatId: string): Promise<{ store: OpenTeamStore }> {
  return retryOrchestrationStage(deps, chatId)
}

async function startStages(deps: OrchestrationRuntimeDependencies, runId: string, stageIndices: number[]): Promise<void> {
  for (const stageIndex of uniqueNumbers(stageIndices)) {
    await startStage(deps, runId, stageIndex)
  }
}

async function startStage(deps: OrchestrationRuntimeDependencies, runId: string, stageIndex: number, preparationAttempt = 0): Promise<StartStageResult> {
  const timestamp = deps.now()
  const preparationRetryDelayMs = preparationRetryDelay(deps, preparationAttempt)
  const prepared = await mutateStore(store => {
    const run = store.orchestrationRunsById[runId]
    if (!run || (run.status !== 'pending' && run.status !== 'running')) return { deliveries: [], externalDeliveries: [] }
    const chat = requireChat(store, run.chatId)
    if (store.activeOrchestrationRunIdByChatId[chat.id] !== run.id) return { deliveries: [], externalDeliveries: [] }
    const flow = run.flowSnapshot ?? requireFlow(store, chat.id, run.flowId)
    if (run.pendingStageIndices && !run.pendingStageIndices.includes(stageIndex)) return { deliveries: [], externalDeliveries: [] }
    if (run.stageRuns.some(sr => sr.stageIndex === stageIndex && sr.status === 'running')) return { deliveries: [], externalDeliveries: [] }
    const stage = flow.stages[stageIndex]
    if (!stage) {
      completeRun(store, chat, run, timestamp)
      return { deliveries: [], externalDeliveries: [] }
    }
    if (run.stageRuns.length >= maxNodeExecutionsForRun(run)) {
      failRun(store, chat, run, `已达到最大节点执行数（${maxNodeExecutionsForRun(run)}），流程可能存在未收敛的循环。`, timestamp)
      return { deliveries: [], externalDeliveries: [] }
    }

    const taskMessage = getRunTaskMessage(store, chat, run)
    if (!taskMessage) throw new Error('找不到编排任务消息')
    const targetRoleIds = targetRoleIdsForStage(stage)
    if (flow.project && targetRoleIds.some(roleId => {
      const role = requireRole(store, chat.id, roleId)
      return role.status === 'thinking' || Boolean(role.lastPromptMessageId) || role.siteHealth?.status === 'blocked' || role.siteHealth?.status === 'unauthorized' || role.status === 'error'
    })) {
      failRun(store, chat, run, 'BLOCKED: task owner is busy, unauthorized or in error; user/source reconciliation required', timestamp)
      return { deliveries: [], externalDeliveries: [] }
    }
    const frameBlocker = findLocalRoleFrameBlocker(store, chat, targetRoleIds, deps)
    if (frameBlocker) {
      if (preparationAttempt >= 3) {
        failRun(store, chat, run, `BLOCKED: ${frameBlocker.roleName}: ${frameBlocker.reason}`, timestamp)
        return { deliveries: [], externalDeliveries: [] }
      }
      return {
        deliveries: [],
        externalDeliveries: [],
        retry: {
          ...frameBlocker,
          chatId: chat.id,
          delayMs: preparationRetryDelayMs,
          retryCount: preparationAttempt + 1,
        },
      }
    }

    removePendingStageRun(run, stageIndex)
    run.pendingStageIndices = run.pendingStageIndices?.filter(index => index !== stageIndex)
    const promptMessage = createStagePromptMessage(deps, store, chat, run, stage, stageIndex, taskMessage.content, timestamp)
    promptMessage.targetRoleIds = targetRoleIds
    promptMessage.mentionedRoleIds = targetRoleIds
    promptMessage.mentionsAll = false
    promptMessage.deliveryStatus = Object.fromEntries(targetRoleIds.map(roleId => [roleId, 'pending' as const]))
    promptMessage.status = targetRoleIds.length > 0 ? 'pending' : 'received'
    store.messagesById[promptMessage.id] = promptMessage
    chat.messageIds.push(promptMessage.id)
    chat.nextMessageSeq += 1

    const stageRun: OrchestrationStageRun = {
      stageId: stage.id,
      stageIndex,
      kind: stage.kind,
      round: run.currentRound,
      status: 'running',
      roleRuns: {},
      startedAt: timestamp,
    }
    run.stageRuns.push(stageRun)
    run.status = 'running'
    run.updatedAt = timestamp
    chat.status = 'running'
    chat.updatedAt = timestamp

    const deliveries: PromptDelivery[] = []
    const externalDeliveries: ExternalPromptDelivery[] = []
    const messages = getChatMessages(store, chat)
    const roles = getChatRoles(store, chat)
    for (const roleId of targetRoleIds) {
      const role = requireRole(store, chat.id, roleId)
      stageRun.roleRuns[role.id] = { roleId: role.id, status: 'running', messageId: promptMessage.id, startedAt: timestamp }
      try {
        const prepared = prepareRolePromptDelivery({ store, chat, role, userMessage: promptMessage, roles, messages, timestamp, newId: deps.newId, runtimeFrames: deps.runtimeFrames })
        if (prepared.delivery) deliveries.push(prepared.delivery)
        if (prepared.externalDelivery) externalDeliveries.push(prepared.externalDelivery)
        role.status = 'thinking'
        role.lastPromptMessageId = promptMessage.id
        role.replyAttemptId = prepared.replyAttemptId
        role.updatedAt = timestamp
      } catch (error) {
        stageRun.roleRuns[role.id].status = 'error'
        stageRun.roleRuns[role.id].error = error instanceof Error ? error.message : String(error)
        role.status = 'error'
        delete role.lastPromptMessageId
        delete role.replyAttemptId
      }
    }
    const failedRoleRun = Object.values(stageRun.roleRuns).find(roleRun => roleRun.status === 'error')
    if (failedRoleRun) {
      deliveries.length = 0
      externalDeliveries.length = 0
      stageRun.status = 'error'
      stageRun.completedAt = timestamp
      run.status = 'error'
      run.error = failedRoleRun.error ?? '节点投递失败'
      chat.status = 'error'
    } else if (targetRoleIds.length === 0 || allRoleRunsFinished(stageRun)) {
      stageRun.status = targetRoleIds.length === 0 ? 'skipped' : 'error'
      stageRun.completedAt = timestamp
      if (stageRun.status === 'error') {
        run.status = 'error'
        run.error = '节点没有可投递人员'
        chat.status = 'error'
      }
    }
    return { deliveries, externalDeliveries }
  })

  if (prepared.result.retry) {
    deps.log.warn('orchestration-stage:preparation-retry-scheduled', {
      chatId: prepared.result.retry.chatId,
      roleId: prepared.result.retry.roleId,
      roleName: prepared.result.retry.roleName,
      runId,
      stageIndex,
      retryCount: prepared.result.retry.retryCount,
      delayMs: prepared.result.retry.delayMs,
      reason: prepared.result.retry.reason,
    })
    const recovered = await deps.requestRoleRecovery?.(prepared.result.retry.chatId, prepared.result.retry.roleId, prepared.result.retry.reason).catch(() => false)
    deps.log.warn('orchestration-diagnostic:stage-preparation-recovery-result', {
      chatId: prepared.result.retry.chatId,
      roleId: prepared.result.retry.roleId,
      roleName: prepared.result.retry.roleName,
      runId,
      stageIndex,
      recovered: recovered ?? false,
      reason: prepared.result.retry.reason,
    })
    if (!recovered) await waitForStagePreparationRetry(deps, prepared.result.retry.delayMs)
    return startStage(deps, runId, stageIndex, preparationAttempt + 1)
  }

  await deps.broadcastStoreUpdated(prepared.store)
  deps.log.warn('orchestration-diagnostic:stage-deliveries-start', {
    runId,
    stageIndex,
    localDeliveries: prepared.result.deliveries.map(delivery => ({
      chatId: delivery.message.chatId,
      roleId: delivery.roleId,
      chatSite: delivery.chatSite,
      messageId: delivery.message.messageId,
      replyAttemptId: delivery.message.replyAttemptId,
      tabId: delivery.tabId,
      frameId: delivery.frameId,
      payloadChatId: delivery.message.chatId,
      payloadRoleId: delivery.message.roleId,
    })),
    externalDeliveries: prepared.result.externalDeliveries.map(delivery => ({
      chatId: delivery.chatId,
      roleId: delivery.roleId,
      model: delivery.model,
      messageId: delivery.messageId,
    })),
  })
  await sendOrchestrationPromptDeliveries(deps, prepared.result.deliveries)
  for (const delivery of prepared.result.externalDeliveries) {
    sendExternalOrchestrationPrompt(deps, delivery).catch(error => {
      deps.log.warn('orchestration-external:failed', { chatId: delivery.chatId, roleId: delivery.roleId, messageId: delivery.messageId, error: error instanceof Error ? error.message : String(error) })
    })
  }
  return { store: prepared.store, deliveries: prepared.result.deliveries, externalDeliveries: prepared.result.externalDeliveries }
}

async function sendOrchestrationPromptDeliveries(deps: OrchestrationRuntimeDependencies, deliveries: PromptDelivery[]): Promise<void> {
  await Promise.all(deliveries.map(delivery => {
    const send = () => sendOrchestrationPromptDelivery(deps, delivery)
    if (!deps.promptDeliveryLimiter) return send().then(() => undefined)
    return deps.promptDeliveryLimiter.enqueue({
      chatId: delivery.message.chatId,
      messageId: delivery.message.messageId,
      roleId: delivery.roleId,
      chatSite: delivery.chatSite,
      send,
    })
  }))
}

async function sendOrchestrationPromptDelivery(deps: OrchestrationRuntimeDependencies, delivery: PromptDelivery): Promise<boolean> {
  const stillActive = await isOrchestrationPromptDeliveryStillActive(
    delivery.message.chatId,
    delivery.roleId,
    delivery.message.messageId,
    delivery.message.replyAttemptId,
  )
  if (!stillActive) return false
  const project = await mutateStore(store => Boolean(store.orchestrationRunsById[store.activeOrchestrationRunIdByChatId[delivery.message.chatId]]?.flowSnapshot?.project))
  if (project.result) {
    try {
      await deps.sendPrompt(delivery)
      return true
    } catch (error) {
      await markOrchestrationRoleError(deps, { chatId: delivery.message.chatId, roleId: delivery.roleId, promptMessageId: delivery.message.messageId, error: `BLOCKED: delivery outcome uncertain; source reconciliation required, no resend: ${error instanceof Error ? error.message : String(error)}` })
      return false
    }
  }
  return sendPromptDeliveryWithRetry({
    log: deps.log,
    sendPrompt: deps.sendPrompt,
    getLatestBinding: (chatId, roleId) => deps.runtimeFrames.getByRole(chatId, roleId),
    isDeliveryStillActive: isOrchestrationPromptDeliveryStillActive,
    markDeliveryError: (chatId, roleId, messageId, reason) => markOrchestrationRoleError(deps, { chatId, roleId, promptMessageId: messageId, error: reason }).then(() => undefined),
    requestRoleRecovery: deps.requestRoleRecovery,
    waitForRetry: deps.waitForRetry,
  }, {
    chatId: delivery.message.chatId,
    messageId: delivery.message.messageId,
    delivery,
    retryDelaysMs: deps.deliveryRetryDelaysMs ?? DEFAULT_PROMPT_DELIVERY_RETRY_DELAYS_MS,
  })
}

async function sendExternalOrchestrationPrompt(deps: OrchestrationRuntimeDependencies, delivery: ExternalPromptDelivery): Promise<void> {
  const client = deps.externalModelClient
  if (!client) {
    await markOrchestrationRoleError(deps, { chatId: delivery.chatId, roleId: delivery.roleId, promptMessageId: delivery.messageId, error: '外部模型客户端不可用' })
    return
  }
  try {
    const result = await client.complete({ model: delivery.model, prompt: delivery.prompt })
    const timestamp = deps.now()
    const stored = await mutateStore(store => {
      const chat = requireChat(store, delivery.chatId)
      const role = requireRole(store, chat.id, delivery.roleId)
      const run = store.orchestrationRunsById[store.activeOrchestrationRunIdByChatId[chat.id]]
      const stageRun = run ? findRunningStageRunForRolePrompt(run, role.id, delivery.messageId) : undefined
      if (role.lastPromptMessageId !== delivery.messageId || role.replyAttemptId !== delivery.replyAttemptId) return undefined
      const reply: GroupMessage = {
        id: deps.newId('msg'),
        chatId: chat.id,
        seq: chat.nextMessageSeq,
        type: 'assistant',
        content: result.content,
        contentFormat: 'markdown',
        roleId: role.id,
        roleName: role.name,
        orchestrationRunId: run?.id,
        orchestrationRound: stageRun?.round,
        orchestrationStageId: stageRun?.stageId,
        orchestrationStageIndex: stageRun?.stageIndex,
        createdAt: timestamp,
        status: 'received',
      }
      store.messagesById[reply.id] = reply
      chat.messageIds.push(reply.id)
      chat.nextMessageSeq += 1
      const prompt = store.messagesById[delivery.messageId]
      if (prompt?.deliveryStatus?.[role.id]) prompt.deliveryStatus[role.id] = 'received'
      role.status = 'ready'
      role.lastReplyAt = timestamp
      role.updatedAt = timestamp
      delete role.lastPromptMessageId
      delete role.replyAttemptId
      chat.status = deps.getChatStatusFromRoles(store, chat)
      chat.updatedAt = timestamp
      return reply
    })
    await deps.broadcastStoreUpdated(stored.store)
    if (stored.result) await maybeAdvanceOrchestrationRun(deps, { chatId: delivery.chatId, roleId: delivery.roleId, promptMessageId: delivery.messageId, replyMessage: stored.result })
  } catch (error) {
    await markOrchestrationRoleError(deps, { chatId: delivery.chatId, roleId: delivery.roleId, promptMessageId: delivery.messageId, error: error instanceof Error ? error.message : String(error) })
  }
}

function createStagePromptMessage(deps: OrchestrationRuntimeDependencies, store: OpenTeamStore, chat: GroupChat, run: OrchestrationRun, stage: OrchestrationStage, stageIndex: number, userTask: string, timestamp: number): GroupMessage {
  let content = stage.kind === 'review'
    ? buildOrchestrationReviewMessageContent({ userTask, currentStage: stage, language: store.settings.language })
    : buildOrchestrationRoleMessageContent({ userTask, currentStage: stage, previousReviewResult: lastReviewResult(run), language: store.settings.language })
  if (run.flowSnapshot?.project) {
    const source = [...run.stageRuns].reverse().find(sr => sr.status === 'completed' && sr.stageId !== stage.id)
    const replies = source ? getChatMessages(store, chat).filter(msg => msg.type === 'assistant' && msg.status === 'received' && Object.values(source.roleRuns).some(rr => rr.messageId === msg.sourceMessageId && rr.roleId === msg.roleId)) : []
    content += `\n\nCompleted source deliveries (read actual artifacts independently):\n${replies.map(reply => JSON.stringify({ messageId: reply.id, roleId: reply.roleId, content: reply.content })).join('\n')}`
  }

  return {
    id: deps.newId('msg'),
    chatId: chat.id,
    seq: chat.nextMessageSeq,
    type: 'user',
    content,
    orchestrationRunId: run.id,
    orchestrationRound: run.currentRound,
    orchestrationStageId: stage.id,
    orchestrationStageIndex: stageIndex,
    orchestrationKind: stage.kind === 'review' ? 'review' : 'role',
    createdAt: timestamp,
    status: 'pending',
  }
}

function lastReviewResult(run: OrchestrationRun): OrchestrationReviewResult | undefined {
  for (const stageRun of [...run.stageRuns].reverse()) {
    const results = stageRun.reviewResults
    const result = results ? results[results.length - 1] : undefined
    if (result) return result
  }
  return undefined
}

function nextStageDecision(store: OpenTeamStore, chat: GroupChat, run: OrchestrationRun, completedStageRun: OrchestrationStageRun, timestamp: number): NextStageDecision {
  const flow = run.flowSnapshot ?? requireFlow(store, chat.id, run.flowId)
  const readyStageIndices = outgoingReadyStageIndices(flow, run, completedStageRun.stageId)
  if (readyStageIndices.length > 0) return queueStages(run, readyStageIndices)
  if (hasRunningStageRuns(run) || run.pendingStageIndices?.length) return { next: false }
  completeRun(store, chat, run, timestamp)
  return { next: false }
}

function applyReviewDecision(store: OpenTeamStore, chat: GroupChat, run: OrchestrationRun, stageRun: OrchestrationStageRun, decision: 'pass' | 'fail', timestamp: number): NextStageDecision {
  const flow = run.flowSnapshot ?? requireFlow(store, chat.id, run.flowId)
  const stage = flow.stages[stageRun.stageIndex]
  if (!stage) return nextStageDecision(store, chat, run, stageRun, timestamp)
  if (decision === 'fail' && reviewAttemptCount(run, stage.id) >= reviewMaxAttempts(stage)) {
    if (stage.review?.onMaxAttempts !== 'continue') {
      failRun(store, chat, run, `审核未通过，已达到最大审核次数（${reviewMaxAttempts(stage)} 次）`, timestamp)
      return { next: false }
    }
    const continueTargets = reviewBranchStageIndices(flow, stageRun.stageId, 'pass')
    if (continueTargets.length > 0) return queueStages(run, continueTargets)
    if (!hasRunningStageRuns(run) && !run.pendingStageIndices?.length) completeRun(store, chat, run, timestamp)
    return { next: false }
  }

  const branchTargets = reviewBranchStageIndices(flow, stageRun.stageId, decision)
  if (branchTargets.length > 0) return queueStages(run, branchTargets)
  if (decision === 'fail' && flow.project) {
    failRun(store, chat, run, 'BLOCKED: REWORK has no repair branch', timestamp)
    return { next: false }
  }
  if (!hasRunningStageRuns(run) && !run.pendingStageIndices?.length) completeRun(store, chat, run, timestamp)
  return { next: false }
}

function completeRun(store: OpenTeamStore, chat: GroupChat, run: OrchestrationRun, timestamp: number): void {
  run.status = 'completed'
  run.completedAt = timestamp
  run.updatedAt = timestamp
  run.pendingStageIndices = []
  delete store.activeOrchestrationRunIdByChatId[chat.id]
  chat.status = 'ready'
  chat.updatedAt = timestamp
}

function failRun(store: OpenTeamStore, chat: GroupChat, run: OrchestrationRun, reason: string, timestamp: number): void {
  run.status = 'error'
  run.error = reason
  run.completedAt = timestamp
  run.updatedAt = timestamp
  delete store.activeOrchestrationRunIdByChatId[chat.id]
  chat.status = 'error'
  chat.updatedAt = timestamp
}

function queueStages(run: OrchestrationRun, stageIndices: number[]): NextStageDecision {
  run.pendingStageIndices = uniqueNumbers([...(run.pendingStageIndices ?? []), ...stageIndices])
  return { next: true, runId: run.id, stageIndices }
}

function requireFlow(store: OpenTeamStore, chatId: string, flowId: string): OrchestrationFlow {
  const flow = store.orchestrationFlowsById[flowId]
  if (!flow || flow.chatId !== chatId) throw new Error(`找不到编排流程：${flowId}`)
  return flow
}

function findResumableRun(store: OpenTeamStore, chat: GroupChat, runId: string | undefined): OrchestrationRun | undefined {
  if (runId) {
    const run = store.orchestrationRunsById[runId]
    return run?.chatId === chat.id ? run : undefined
  }
  const activeRunId = store.activeOrchestrationRunIdByChatId[chat.id]
  const activeRun = activeRunId ? store.orchestrationRunsById[activeRunId] : undefined
  if (activeRun?.status === 'stopped') return activeRun
  return Object.values(store.orchestrationRunsById)
    .filter(run => run.chatId === chat.id && run.status === 'stopped')
    .sort((a, b) => b.updatedAt - a.updatedAt)[0]
}

function validateExecutableFlow(store: OpenTeamStore, chat: GroupChat, flow: OrchestrationFlow): void {
  if (!Array.isArray(flow.stages) || flow.stages.length === 0) throw new Error('编排流程没有可执行节点')
  for (const stage of flow.stages) {
    if (stage.kind === 'roles' && stage.roleIds.length === 0) throw new Error(`执行节点缺少人员：${stage.name}`)
    if (stage.kind === 'review' && stage.review?.reviewerRoleIds?.length !== 1) throw new Error(`复核节点必须绑定一个复核人员：${stage.name}`)
    const roleIds = stage.kind === 'review' ? stage.review?.reviewerRoleIds ?? [] : stage.roleIds
    for (const roleId of roleIds) requireRole(store, chat.id, roleId)
  }
}

function targetRoleIdsForStage(stage: OrchestrationStage): string[] {
  return stage.kind === 'review' ? [firstReviewerRoleId(stage)] : stage.roleIds
}

function findLocalRoleFrameBlocker(
  store: OpenTeamStore,
  chat: GroupChat,
  roleIds: string[],
  deps: Pick<OrchestrationRuntimeDependencies, 'runtimeFrames'>,
): Pick<StartStagePreparationRetry, 'roleId' | 'roleName' | 'reason'> | undefined {
  for (const roleId of roleIds) {
    const role = requireRole(store, chat.id, roleId)
    if (isExternalModelRole(role)) continue
    const binding = deps.runtimeFrames.getByRole(chat.id, role.id)
    if (!binding?.ready) {
      return { roleId: role.id, roleName: role.name, reason: '人员 iframe 尚未就绪，请先恢复人员' }
    }
  }
  return undefined
}

function preparationRetryDelay(deps: Pick<OrchestrationRuntimeDependencies, 'deliveryRetryDelaysMs'>, attempt: number): number {
  const delays = deps.deliveryRetryDelaysMs?.length ? deps.deliveryRetryDelaysMs : DEFAULT_PROMPT_DELIVERY_RETRY_DELAYS_MS
  return delays[Math.min(attempt, delays.length - 1)] ?? DEFAULT_PROMPT_DELIVERY_RETRY_DELAYS_MS[DEFAULT_PROMPT_DELIVERY_RETRY_DELAYS_MS.length - 1]
}

async function waitForStagePreparationRetry(deps: Pick<OrchestrationRuntimeDependencies, 'waitForRetry'>, delayMs: number): Promise<void> {
  if (delayMs <= 0) return
  if (deps.waitForRetry) {
    await deps.waitForRetry(delayMs)
    return
  }
  await new Promise<void>(resolve => setTimeout(resolve, delayMs))
}

function normalizeMaxNodeExecutions(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_ORCHESTRATION_MAX_NODE_EXECUTIONS
  return Math.min(MAX_ORCHESTRATION_MAX_NODE_EXECUTIONS, Math.max(1, Math.floor(value)))
}

function currentStageRun(run: OrchestrationRun): OrchestrationStageRun | undefined {
  return run.stageRuns[run.stageRuns.length - 1]
}

function findRunningStageRunForRolePrompt(run: OrchestrationRun, roleId: string, promptMessageId: string): OrchestrationStageRun | undefined {
  return run.stageRuns.find(stageRun => {
    const roleRun = stageRun.roleRuns[roleId]
    return stageRun.status === 'running' && roleRun?.messageId === promptMessageId && roleRun.status === 'running'
  })
}

function allRoleRunsFinished(stageRun: OrchestrationStageRun): boolean {
  const roleRuns = Object.values(stageRun.roleRuns)
  return roleRuns.length > 0 && roleRuns.every(roleRun => roleRun.status === 'completed' || roleRun.status === 'skipped')
}

function hasRunningStageRuns(run: OrchestrationRun): boolean {
  return run.stageRuns.some(stageRun => stageRun.status === 'running')
}

async function isOrchestrationPromptDeliveryStillActive(chatId: string, roleId: string, messageId: string, replyAttemptId: string | undefined): Promise<boolean> {
  const { result } = await mutateStore(store => {
    const chat = requireChat(store, chatId)
    const role = requireRole(store, chat.id, roleId)
    if (role.status === 'stopped') return false
    if (role.lastPromptMessageId !== messageId) return false
    if (replyAttemptId && role.replyAttemptId !== replyAttemptId) return false
    const runId = store.activeOrchestrationRunIdByChatId[chat.id]
    const run = runId ? store.orchestrationRunsById[runId] : undefined
    if (!run || run.status !== 'running') return false
    return Boolean(findRunningStageRunForRolePrompt(run, roleId, messageId))
  })
  return result
}

function hasLiveRunningRolePrompt(store: OpenTeamStore, chat: GroupChat, run: OrchestrationRun): boolean {
  return run.stageRuns.some(stageRun => {
    if (stageRun.status !== 'running') return false
    return Object.values(stageRun.roleRuns).some(roleRun => {
      if (roleRun.status !== 'running' || !roleRun.messageId) return false
      const role = store.rolesById[roleRun.roleId]
      return role?.chatId === chat.id && role.status === 'thinking' && role.lastPromptMessageId === roleRun.messageId
    })
  })
}

function stopStaleActiveRun(store: OpenTeamStore, chat: GroupChat, run: OrchestrationRun, timestamp: number): void {
  run.status = 'stopped'
  run.completedAt = timestamp
  run.updatedAt = timestamp
  run.error = run.error ?? '运行状态已失效，已自动释放'
  for (const stageRun of run.stageRuns) {
    if (stageRun.status === 'running' || stageRun.status === 'pending') {
      stageRun.status = 'skipped'
      stageRun.completedAt = timestamp
    }
    for (const roleRun of Object.values(stageRun.roleRuns)) {
      if (roleRun.status === 'running' || roleRun.status === 'pending') {
        roleRun.status = 'skipped'
        roleRun.completedAt = timestamp
      }
    }
  }
  delete store.activeOrchestrationRunIdByChatId[chat.id]
}

function outgoingReadyStageIndices(flow: OrchestrationFlow, run: OrchestrationRun, sourceStageId: string): number[] {
  const stageIndexById = new Map(flow.stages.map((stage, index) => [stage.id, index]))
  const candidateIds = effectiveGraphEdges(flow)
    .filter(edge => edge.sourceStageId === sourceStageId && reviewEdgeBranch(edge) !== 'fail')
    .map(edge => edge.targetStageId)
  const ready = candidateIds
    .filter(stageId => isStageReadyFromIncoming(flow, run, stageId))
    .map(stageId => stageIndexById.get(stageId))
    .filter((index): index is number => typeof index === 'number')
  return uniqueNumbers(ready)
}

function isStageReadyFromIncoming(flow: OrchestrationFlow, run: OrchestrationRun, stageId: string): boolean {
  if (run.stageRuns.some(stageRun => stageRun.stageId === stageId && stageRun.status === 'running')) return false
  const incoming = incomingEdgesByTarget(flow).get(stageId) ?? []
  if (incoming.length <= 1) return true
  return incoming.every(sourceStageId => run.stageRuns.some(stageRun => stageRun.stageId === sourceStageId && (stageRun.status === 'completed' || stageRun.status === 'skipped')))
}

function maxNodeExecutionsForRun(run: OrchestrationRun): number {
  return normalizeMaxNodeExecutions(run.maxNodeExecutions ?? run.maxRounds)
}

function reviewMaxAttempts(stage: OrchestrationStage): number {
  const value = stage.review?.maxAttempts
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_ORCHESTRATION_REVIEW_MAX_ATTEMPTS
  return Math.min(MAX_ORCHESTRATION_MAX_NODE_EXECUTIONS, Math.max(1, Math.floor(value)))
}

function reviewAttemptCount(run: OrchestrationRun, stageId: string): number {
  return run.stageRuns.filter(stageRun => stageRun.stageId === stageId && stageRun.kind === 'review').length
}

function rootStageIndices(flow: OrchestrationFlow): number[] {
  const targetIds = new Set(dependencyGraphEdges(flow).map(edge => edge.targetStageId))
  const roots = flow.stages.map((stage, index) => targetIds.has(stage.id) ? undefined : index).filter((index): index is number => typeof index === 'number')
  return roots.length > 0 ? roots : [0]
}

function incomingEdgesByTarget(flow: OrchestrationFlow): Map<string, string[]> {
  const incoming = new Map<string, string[]>()
  for (const edge of dependencyGraphEdges(flow)) {
    incoming.set(edge.targetStageId, [...incoming.get(edge.targetStageId) ?? [], edge.sourceStageId])
  }
  return incoming
}

function dependencyGraphEdges(flow: OrchestrationFlow): OrchestrationGraphSnapshot['edges'] {
  return effectiveGraphEdges(flow).filter(edge => reviewEdgeBranch(edge) !== 'fail')
}

function reviewBranchStageIndices(flow: OrchestrationFlow, reviewStageId: string, branch: 'pass' | 'fail'): number[] {
  const stageIndexById = new Map(flow.stages.map((stage, index) => [stage.id, index]))
  return effectiveGraphEdges(flow)
    .filter(edge => edge.sourceStageId === reviewStageId && reviewEdgeMatchesBranch(edge, branch))
    .map(edge => stageIndexById.get(edge.targetStageId))
    .filter((index): index is number => typeof index === 'number')
}

function reviewEdgeMatchesBranch(edge: OrchestrationGraphSnapshot['edges'][number], branch: 'pass' | 'fail'): boolean {
  const edgeBranch = reviewEdgeBranch(edge)
  if (branch === 'pass') return edgeBranch !== 'fail'
  return edgeBranch === 'fail'
}

function reviewEdgeBranch(edge: OrchestrationGraphSnapshot['edges'][number]): 'pass' | 'fail' | undefined {
  if (edge.sourcePort === 'pass' || edge.sourcePort === 'fail') return edge.sourcePort
  return undefined
}

function effectiveGraphEdges(flow: OrchestrationFlow): OrchestrationGraphSnapshot['edges'] {
  const stageIds = new Set(flow.stages.map(stage => stage.id))
  const edges = flow.graph ? flow.graph.edges : flow.stages.slice(1).map((stage, index) => ({ sourceStageId: flow.stages[index].id, targetStageId: stage.id }))
  return edges.filter(edge => stageIds.has(edge.sourceStageId) && stageIds.has(edge.targetStageId) && edge.sourceStageId !== edge.targetStageId)
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)]
}

function requireActiveRun(store: OpenTeamStore, chat: GroupChat): OrchestrationRun {
  const runId = store.activeOrchestrationRunIdByChatId[chat.id]
  const run = runId ? store.orchestrationRunsById[runId] : undefined
  if (!run) throw new Error('该群聊没有运行中的编排')
  return run
}

function findRetryableStageRun(run: OrchestrationRun, stageId?: string): OrchestrationStageRun | undefined {
  const candidate = stageId ? [...run.stageRuns].reverse().find(stageRun => stageRun.stageId === stageId) : currentStageRun(run)
  if (!candidate || (candidate.status !== 'error' && candidate.status !== 'running')) return undefined
  return candidate
}

function findRestartingStageRun(run: OrchestrationRun, stageId?: string): OrchestrationStageRun | undefined {
  const candidate = stageId ? [...run.stageRuns].reverse().find(stageRun => stageRun.stageId === stageId) : currentStageRun(run)
  return candidate?.status === 'pending' ? candidate : undefined
}

function removeStageRunAndFollowing(run: OrchestrationRun, stageRun: OrchestrationStageRun): void {
  const index = run.stageRuns.indexOf(stageRun)
  if (index >= 0) run.stageRuns.splice(index)
}

function removeStageRunsAfter(run: OrchestrationRun, stageRun: OrchestrationStageRun): void {
  const index = run.stageRuns.indexOf(stageRun)
  if (index >= 0) run.stageRuns.splice(index + 1)
}

function markStageRunRestarting(stageRun: OrchestrationStageRun, timestamp: number): void {
  stageRun.status = 'pending'
  stageRun.startedAt = timestamp
  delete stageRun.completedAt
  for (const roleRun of Object.values(stageRun.roleRuns)) {
    roleRun.status = 'pending'
    roleRun.startedAt = timestamp
    delete roleRun.completedAt
    delete roleRun.error
    delete roleRun.messageId
  }
}

function removePendingStageRun(run: OrchestrationRun, stageIndex: number): void {
  const index = run.stageRuns.findIndex(stageRun => stageRun.stageIndex === stageIndex && stageRun.status === 'pending')
  if (index >= 0) run.stageRuns.splice(index, 1)
}

function firstReviewerRoleId(stage: OrchestrationStage): string {
  const roleId = stage.review?.reviewerRoleIds[0]
  if (!roleId) throw new Error(`复核节点缺少复核人员：${stage.name}`)
  return roleId
}

function getRunTaskMessage(store: OpenTeamStore, chat: GroupChat, run: OrchestrationRun): GroupMessage | undefined {
  return getChatMessages(store, chat).find(message => message.orchestrationRunId === run.id && message.orchestrationKind === 'task')
}

export function generateTestTrace(store: OpenTeamStore, runId: string): TestRunTrace {
  const run = store.orchestrationRunsById[runId]
  if (!run) throw new Error('找不到测试运行记录')
  const chat = store.chatsById[run.chatId]
  const flow = store.orchestrationFlowsById[run.flowId]
  if (!chat || !flow) throw new Error('缺失聊天或流程数据')

  const stages = run.stageRuns.map(sr => {
    const stage = flow.stages[sr.stageIndex]
    const roleResults = Object.entries(sr.roleRuns).map(([roleId, roleRun]) => {
      const role = store.rolesById[roleId]
      const promptMsg = roleRun.messageId ? store.messagesById[roleRun.messageId] : undefined
      const reply = promptMsg ? getChatMessages(store, chat).find(message =>
        message.type === 'assistant' &&
        message.roleId === roleId &&
        message.sourceMessageId === promptMsg.id &&
        message.orchestrationRunId === run.id,
      ) : undefined
      return {
        roleId,
        roleName: role?.name ?? '未知人员',
        input: promptMsg?.content ?? '无输入',
        output: reply?.content ?? roleRun.error ?? '无输出',
        status: roleRun.status,
      }
    })
    return {
      stageId: sr.stageId,
      stageIndex: sr.stageIndex,
      name: stage?.name ?? '未知阶段',
      roleResults,
      status: sr.status,
    }
  })

  return {
    runId: run.id,
    task: flow.description ?? '无任务描述',
    stages,
    totalDurationMs: run.completedAt ? run.completedAt - run.createdAt : 0,
  }
}
