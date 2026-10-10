import type { BackgroundMessageRoute } from './messageRouter'
import { loadStore } from '../group/store'
import { mutateStore, requireChat, requireRole } from './storeAccess'
import { startOrchestrationRun, stopOrchestrationRun, resumeOrchestrationRun, type OrchestrationRuntimeDependencies } from './orchestrationRuntime'
import { compileProjectBacklog } from '../group/projectBacklog'
import { ancestorIds, applyManagerBreakdown, importProjectTodo, nextProjectTask, projectSummary } from '../group/projectWorkspace'
import type { OpenTeamStore, OrchestrationFlow, ProjectTaskNode, ProjectWorkspace, ProjectNodeStatus } from '../group/types'

export function createProjectWorkspaceRuntime(deps: OrchestrationRuntimeDependencies) {
  let pumping: Promise<void> | undefined

  const pump = (): Promise<void> => {
    if (pumping) return pumping
    pumping = pumpAll().finally(() => { pumping = undefined })
    return pumping
  }

  async function pumpAll(): Promise<void> {
    const snapshot = await loadStore()
    for (const id of Object.values(snapshot.projectsById ?? {}).filter(project => project.status === 'running').map(project => project.id)) {
      // Bounded reconciliation permits a synchronous model response without
      // recursion. A later reply/alarm continues any remaining checkpoint.
      for (let tick = 0; tick < 4; tick += 1) {
        const prepared = await mutateStore(store => prepareProject(store, id, deps.now()))
        if (prepared.result.changed) await deps.broadcastStoreUpdated(prepared.store)
        const action = prepared.result.action
        if (!action) break
        try {
          await startOrchestrationRun(deps, { chatId: action.chatId, flowId: action.flowId, task: action.task })
        } catch (error) {
          const failed = await mutateStore(store => {
            const project = store.projectsById?.[id]
            if (!project || project.status !== 'running') return
            project.status = 'blocked'
            project.reason = error instanceof Error ? error.message : String(error)
            project.updatedAt = deps.now()
            const node = project.nodes.find(item => item.id === project.activeNodeId)
            if (node) setNodeStatus(node, 'blocked', deps.now(), project.reason)
          })
          await deps.broadcastStoreUpdated(failed.store)
          break
        }
      }
    }
  }

  const routes: BackgroundMessageRoute[] = [
    { type: 'GROUP_PROJECT_IMPORT_TODO', handler: async message => {
      const imported = importProjectTodo(message.project, deps.now())
      const result = await mutateStore(store => {
        const chat = requireChat(store, imported.chatId)
        for (const roleId of [imported.managerRoleId, imported.reviewerRoleId, ...imported.engineers.map(item => item.roleId)]) {
          requireRole(store, chat.id, roleId)
          if (!chat.roleIds.includes(roleId)) throw new Error(`Role is outside project chat: ${roleId}`)
        }
        const existing = store.projectsById?.[imported.id]
        if (existing) {
          for (const field of ['chatId', 'name', 'goals', 'sourcePath', 'sourceText', 'managerRoleId', 'reviewerRoleId', 'engineers'] as const) {
            if (JSON.stringify(existing[field]) !== JSON.stringify(imported[field])) throw new Error('Project id already has a different TODO or configuration; existing acceptance is preserved')
          }
          return existing
        }
        store.projectsById ??= {}
        store.projectsById[imported.id] = imported
        return imported
      })
      await deps.broadcastStoreUpdated(result.store)
      return { ok: true, project: result.result, store: result.store }
    } },
    { type: 'GROUP_PROJECT_EXECUTE', handler: async message => {
      const result = await mutateStore(store => {
        const project = requireProject(store, message.projectId)
        if (project.status === 'paused') throw new Error('Resume the paused project; do not start it again')
        if (project.status === 'blocked') throw new Error(project.reason || 'Project requires source/permission reconciliation')
        const activeRun = store.orchestrationRunsById[store.activeOrchestrationRunIdByChatId[project.chatId]]
        if (activeRun && activeRun.flowSnapshot?.project?.workspaceId !== project.id && activeRun.status !== 'completed') throw new Error('Reconcile the existing chat run before starting a project workspace')
        for (const other of Object.values(store.projectsById ?? {})) {
          if (other.id === project.id || other.status === 'draft' || other.status === 'completed') continue
          if (other.chatId === project.chatId || other.engineers.some(a => project.engineers.some(b => resourceKey(a.worktree) === resourceKey(b.worktree) || a.branch.toLowerCase() === b.branch.toLowerCase()))) throw new Error('Another project owns this chat, branch or worktree')
        }
        if (project.status !== 'completed') project.status = 'running'
        project.updatedAt = deps.now()
        return project.id
      })
      await deps.broadcastStoreUpdated(result.store)
      await pump()
      const latest = await mutateStore(store => requireProject(store, result.result))
      return { ok: true, project: latest.result, store: latest.store }
    } },
    { type: 'GROUP_PROJECT_WORKSPACE_PAUSE', handler: async message => {
      const result = await mutateStore(store => {
        const project = requireProject(store, message.projectId)
        if (project.status === 'blocked') throw new Error('Pause cannot clear a blocked project')
        if (project.status === 'completed') throw new Error('Project is already completed')
        project.status = 'paused'
        project.updatedAt = deps.now()
        const activeRun = store.orchestrationRunsById[store.activeOrchestrationRunIdByChatId[project.chatId]]
        return { chatId: project.chatId, ownsRun: activeRun?.flowSnapshot?.project?.workspaceId === project.id }
      })
      if (result.result.ownsRun) await stopOrchestrationRun(deps, result.result.chatId)
      const latest = await mutateStore(store => requireProject(store, message.projectId))
      await deps.broadcastStoreUpdated(latest.store)
      return { ok: true, project: latest.result, store: latest.store }
    } },
    { type: 'GROUP_PROJECT_WORKSPACE_RESUME', handler: async message => {
      const result = await mutateStore(store => {
        const project = requireProject(store, message.projectId)
        if (project.status !== 'paused') throw new Error('Only paused projects may resume; blocked work requires reconciliation')
        project.status = 'running'
        project.updatedAt = deps.now()
        const node = project.nodes.find(item => item.id === project.activeNodeId)
        const run = node?.runKey ? Object.values(store.orchestrationRunsById).find(item => item.flowSnapshot?.project?.id === node.runKey) : undefined
        return { chatId: project.chatId, runId: run?.status === 'stopped' ? run.id : undefined }
      })
      if (result.result.runId) await resumeOrchestrationRun(deps, result.result)
      await pump()
      const latest = await mutateStore(store => requireProject(store, message.projectId))
      await deps.broadcastStoreUpdated(latest.store)
      return { ok: true, project: latest.result, store: latest.store }
    } },
  ]
  return { routes, pump }
}

function prepareProject(store: OpenTeamStore, id: string, now: number): { changed: boolean; action?: { chatId: string; flowId: string; task: string } } {
  const project = store.projectsById?.[id]
  if (!project || project.status !== 'running') return { changed: false }
  let changed = false
  let active = project.nodes.find(item => item.id === project.activeNodeId)
  if (active?.runKey) {
    const run = Object.values(store.orchestrationRunsById).find(item => item.chatId === project.chatId && item.flowSnapshot?.project?.id === active!.runKey)
    if (run) {
      active.runId = run.id
      if (run.status === 'error') {
        project.status = 'blocked'
        project.reason = run.error || 'Run failed; original source reconciliation required'
        setNodeStatus(active, 'blocked', now, project.reason)
        project.updatedAt = now
        return { changed: true }
      }
      if (run.status === 'stopped') { project.status = 'paused'; project.updatedAt = now; return { changed: true } }
      if (run.status !== 'completed') {
        const stage = run.stageRuns[run.stageRuns.length - 1]
        const failedReview = run.stageRuns.some(item => item.reviewResults?.some(review => review.decision === 'fail'))
        const status = !active.planned ? 'planning' : stage?.kind === 'review' ? 'review' : failedReview ? 'rework' : 'running'
        changed = active.status !== status
        if (changed) { setNodeStatus(active, status, now); project.updatedAt = now }
        return { changed }
      }
      try {
        if (!active.planned) {
          const managerPromptId = run.stageRuns[0]?.roleRuns[project.managerRoleId]?.messageId
          const reply = Object.values(store.messagesById).find(item => item.chatId === project.chatId && item.type === 'assistant' && item.roleId === project.managerRoleId && item.sourceMessageId === managerPromptId && item.status === 'received')
          if (!reply) throw new Error('Completed Manager planning reply is missing')
          applyManagerBreakdown(project, active, reply.content, now)
          active.events.push({ at: now, status: 'open', reason: `Manager breakdown source: ${reply.id}` })
        } else {
          const review = run.stageRuns[run.stageRuns.length - 1]?.reviewResults?.slice(-1)[0]
          if (!review || review.decision !== 'pass') throw new Error('Final independent PASS is missing')
          const proof = JSON.parse(review.rawJson) as { verified?: boolean; evidence?: string[] }
          if (!proof.verified || !proof.evidence?.length) throw new Error('Independent source/test/Git evidence missing')
          active.evidence = [...proof.evidence, `Reviewer response: ${review.messageId}`, `Run: ${run.id}`]
          active.acceptedAt = now
          setNodeStatus(active, 'accepted', now, 'Independent reviewer accepted source/test/Git evidence')
        }
      } catch (error) {
        project.status = 'blocked'
        project.reason = error instanceof Error ? error.message : String(error)
        setNodeStatus(active, 'blocked', now, project.reason)
        project.updatedAt = now
        return { changed: true }
      }
      delete project.activeNodeId
      active = undefined
      changed = true
    }
  }
  if (!active) {
    const summary = projectSummary(project)
    if (summary.total > 0 && summary.accepted === summary.total) {
      project.status = 'completed'
      delete project.reason
      project.updatedAt = now
      return { changed: true }
    }
    active = nextProjectTask(project)
    if (!active) {
      project.status = 'blocked'
      project.reason = project.nodes.some(item => item.requiresApproval) ? 'User approval required for remaining work; automatic execution stopped' : 'No ready task; dependency acceptance or source reconciliation required'
      project.updatedAt = now
      return { changed: true }
    }
    const ordinal = project.nodes.filter(item => item.ownerRoleId && item.kind === 'task').length
    active.ownerRoleId ??= project.engineers[ordinal % project.engineers.length].roleId
    active.runKey = `workspace:${project.id}:${active.id}:${active.planned ? 'execute' : 'plan'}`
    setNodeStatus(active, active.planned ? 'queued' : 'planning', now)
    project.activeNodeId = active.id
    changed = true
  }
  const flow = flowForNode(project, active, now)
  store.orchestrationFlowsById[flow.id] ??= flow
  const order = store.orchestrationFlowOrderByChatId[project.chatId] ?? []
  store.orchestrationFlowOrderByChatId[project.chatId] = [...new Set([...order, flow.id])]
  project.updatedAt = now
  return { changed, action: { chatId: project.chatId, flowId: flow.id, task: `Project: ${project.name}\nGoals: ${project.goals}\nTask ancestry: ${ancestorIds(project, active).map(id => project.nodes.find(node => node.id === id)!.title).join(' → ')}\nOnly the assigned task/phase is authorized. Source TODO: ${project.sourcePath}:${active.sourceLine ?? 'Manager phase'}. Historical checked boxes do not prove acceptance.` } }
}

function flowForNode(project: ProjectWorkspace, node: ProjectTaskNode, now: number): OrchestrationFlow {
  const owner = project.engineers.find(item => item.roleId === node.ownerRoleId)!
  const flow = compileProjectBacklog({ id: node.runKey, chatId: project.chatId, managerRoleId: project.managerRoleId, reviewerRoleId: project.reviewerRoleId, tasks: [{ id: node.id, instruction: node.instruction, acceptance: node.acceptance, ownerRoleId: owner.roleId, branch: owner.branch, worktree: owner.worktree }] }, now)
  flow.project!.workspaceId = project.id
  if (!node.planned) {
    flow.stages = [flow.stages[0]]
    flow.stages[0].description += '\n\nPLAN ONLY: do not write files, run OS actions or claim completion. Decompose this exact task into 1..8 concrete phases, covering its acceptance criteria within project goals and assigned scope. Last phase must verify the integrated original requirement. Return only JSON {"phases":[{"title":"...","instruction":"bounded actionable work","acceptance":"specific verifiable tests/readback","requiresApproval":false}]}. Flag any phase needing production/native/credential/OS authorization as requiresApproval:true. Phases run serially; never expand scope. Return {"blocked":true,"reason":"..."} if scope cannot be planned safely.'
    flow.graph = { stageNodes: flow.stages, edges: [] }
    flow.maxNodeExecutions = 1
  }
  return flow
}

function setNodeStatus(node: ProjectTaskNode, status: ProjectNodeStatus, at: number, reason?: string): void {
  if (node.status !== status || node.reason !== reason) node.events.push({ at, status, reason })
  node.status = status
  node.reason = reason
}

function requireProject(store: OpenTeamStore, id: unknown): ProjectWorkspace {
  if (typeof id !== 'string' || !store.projectsById?.[id]) throw new Error('Project not found')
  return store.projectsById[id]
}

function resourceKey(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()
}
