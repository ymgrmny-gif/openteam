import { describe, expect, it, vi } from 'vitest'
import { importProjectTodo, projectSummary } from '../group/projectWorkspace'
import { createDefaultStore } from '../group/store'
import type { OrchestrationRuntimeDependencies } from './orchestrationRuntime'

const baseCommit = 'a'.repeat(40)
const input = (todo: string) => ({ id: 'p', chatId: 'chat-1', name: 'Service', goals: 'Safe modular work', sourcePath: 'TODO.md', todo, managerRoleId: 'manager', reviewerRoleId: 'reviewer', execution: { baseCommit, allowedPaths: { a: ['src/a'], b: ['src/b'] } }, engineers: [{ roleId: 'a', branch: 'codex/a', worktree: 'C:/work/a' }, { roleId: 'b', branch: 'codex/b', worktree: 'C:/work/b' }] })

async function setup(todo: string) {
  vi.resetModules()
  const { STORE_KEY, loadStore } = await import('../group/store')
  const initial = createDefaultStore()
  initial.chatOrder = ['chat-1']
  initial.chatsById['chat-1'] = { id: 'chat-1', name: 'Room', mode: 'independent', roleIds: ['manager', 'a', 'b', 'reviewer'], messageIds: [], nextMessageSeq: 1, status: 'ready', createdAt: 1, updatedAt: 1 }
  for (const id of initial.chatsById['chat-1'].roleIds) initial.rolesById[id] = { id, chatId: 'chat-1', name: id, status: 'ready', contextCursor: 0, createdAt: 1, updatedAt: 1 }
  initial.projectsById = { p: importProjectTodo(input(todo), 1) }
  const stored: Record<string, unknown> = { [STORE_KEY]: structuredClone(initial) }
  vi.stubGlobal('chrome', { storage: { local: {
    get: vi.fn(async (key?: string | string[] | null) => key == null ? structuredClone(stored) : Array.isArray(key) ? Object.fromEntries(key.map(item => [item, structuredClone(stored[item])])) : { [key]: structuredClone(stored[key]) }),
    set: vi.fn(async (items: Record<string, unknown>) => Object.assign(stored, structuredClone(items))),
    remove: vi.fn(async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key] }),
  } } })
  let seq = 0
  const deps: OrchestrationRuntimeDependencies = { broadcastStoreUpdated: vi.fn(), getChatStatusFromRoles: () => 'ready', log: { info: vi.fn(), warn: vi.fn() }, newId: prefix => `${prefix}-${++seq}`, now: () => 1, runtimeFrames: { getByRole: vi.fn((_chatId, roleId) => ({ chatId: 'chat-1', roleId, tabId: 101, frameId: 1, ready: true, lastSeenAt: 1 })) }, sendPrompt: vi.fn(async () => undefined) }
  const { createProjectWorkspaceRuntime } = await import('./projectWorkspaceRuntime')
  let runtime = createProjectWorkspaceRuntime(deps)
  const invoke = (type: string, extra = {}) => runtime.routes.find(route => route.type === type)!.handler({ type, projectId: 'p', ...extra }, {})
  const reply = async (roleId: string, content: string) => {
    const { mutateStore } = await import('./storeAccess')
    const saved = await mutateStore(store => {
      const chat = store.chatsById['chat-1']
      const prompt = [...chat.messageIds].reverse().map(id => store.messagesById[id]).find(message => message.type === 'user')!
      const message = { id: deps.newId('reply'), chatId: chat.id, seq: chat.nextMessageSeq++, type: 'assistant' as const, roleId, sourceMessageId: prompt.id, content, status: 'received' as const, createdAt: 1 }
      store.messagesById[message.id] = message
      chat.messageIds.push(message.id)
      prompt.deliveryStatus![roleId] = 'received'
      store.rolesById[roleId].status = 'ready'
      delete store.rolesById[roleId].lastPromptMessageId
      return message
    })
    const { maybeAdvanceOrchestrationRun } = await import('./orchestrationRuntime')
    await maybeAdvanceOrchestrationRun(deps, { chatId: 'chat-1', roleId, promptMessageId: saved.result.sourceMessageId, replyMessage: saved.result })
    await runtime.pump()
    return saved.result.id
  }
  const readiness = async (taskId: string, owner = 'a', override = {}) => {
    const planMessageId = await reply('manager', 'Bounded assignment; read-only Git probes')
    const { executionForNode } = await import('../group/projectExecutionGate')
    const project = (await loadStore()).projectsById!.p
    const expected = executionForNode(project, project.nodes.find(node => node.id === taskId)!)
    await reply('reviewer', JSON.stringify({ decision: 'pass', reason: 'Read-only probes verified', failedCriteria: [], nextRoundInstruction: '', taskId, planMessageId, verified: true, evidence: ['Git status/branch/worktree/ancestor probes'], readiness: { branch: `codex/${owner}`, worktree: `C:/work/${owner}`, baseCommit, headCommit: baseCommit, clean: true, baseIsAncestor: true, allowedPaths: expected.allowedPaths, dependencies: expected.dependencies.map(dep => ({ ...dep, isAncestor: true })), ...override } }))
  }
  const acceptPlan = async (taskId: string, planMessageId: string, override = {}) => reply('reviewer', JSON.stringify({ decision: 'pass', reason: 'All original criteria covered', failedCriteria: [], nextRoundInstruction: '', taskId, planMessageId, verified: true, coverageVerified: true, evidence: ['Every original criterion and permission boundary reviewed'], ...override }))
  const deliver = async (taskId: string, owner = 'a') => {
    await readiness(taskId, owner)
    const workerMessageId = await reply(owner, 'Actual source readback, tests exit 0 and local Git commit')
    await reply('reviewer', JSON.stringify({ decision: 'pass', reason: 'Independently verified', failedCriteria: [], nextRoundInstruction: '', taskId, workerMessageId, verified: true, evidence: ['source readback', 'tests exit 0', 'Git ownership verified'], artifact: { commit: 'b'.repeat(40), baseCommit, branch: `codex/${owner}`, worktree: `C:/work/${owner}`, changedPaths: [`src/${owner}/index.ts`], acceptanceLevel: 'source' } }))
  }
  return { deps, invoke, reply, deliver, readiness, acceptPlan, getStore: loadStore, pump: () => runtime.pump(), reload: () => { runtime = createProjectWorkspaceRuntime(deps) } }
}

describe('project workspace runtime', () => {
  it('resumes the same proven unsent initial checkpoint after iframe recovery, including reload', async () => {
    const h = await setup('- [ ] Audit <!-- openteam: {"id":"audit","executable":true} -->')
    h.deps.waitForRetry = vi.fn(async () => undefined)
    vi.mocked(h.deps.runtimeFrames.getByRole).mockReturnValue(undefined)
    await h.invoke('GROUP_PROJECT_EXECUTE')
    const before = (await h.getStore()).projectsById!.p
    const originalRunId = before.nodes[0].runId
    expect(before.status).toBe('blocked')
    expect(h.deps.sendPrompt).not.toHaveBeenCalled()
    await expect(h.invoke('GROUP_PROJECT_WORKSPACE_RESUME')).rejects.toThrow('Only paused')
    vi.mocked(h.deps.runtimeFrames.getByRole).mockImplementation((_chatId, roleId) => ({ chatId: 'chat-1', roleId, tabId: 101, frameId: 1, ready: true, lastSeenAt: 1 }))
    h.reload()
    await h.invoke('GROUP_PROJECT_WORKSPACE_RESUME')
    const store = await h.getStore()
    expect(store.projectsById!.p.status).toBe('running')
    expect(store.projectsById!.p.nodes[0].runId).toBe(originalRunId)
    expect(Object.keys(store.orchestrationRunsById)).toHaveLength(1)
    expect(store.orchestrationRunsById[originalRunId!].preflightResumeCount).toBe(1)
    expect(h.deps.sendPrompt).toHaveBeenCalledTimes(1)
    await expect(h.invoke('GROUP_PROJECT_WORKSPACE_RESUME')).rejects.toThrow('Only paused')
    await h.pump()
    expect(h.deps.sendPrompt).toHaveBeenCalledTimes(1)
  })
  it('does not resume an uncertain delivery or other blocked reason', async () => {
    const h = await setup('- [ ] Audit <!-- openteam: {"id":"audit","executable":true} -->')
    vi.mocked(h.deps.sendPrompt).mockRejectedValue(new Error('Transport disconnected after dispatch'))
    await h.invoke('GROUP_PROJECT_EXECUTE')
    expect((await h.getStore()).projectsById!.p.status).toBe('blocked')
    await expect(h.invoke('GROUP_PROJECT_WORKSPACE_RESUME')).rejects.toThrow('Only paused')
    expect(h.deps.sendPrompt).toHaveBeenCalledTimes(1)
  })
  it('blocks before worker dispatch when an accepted prerequisite is absent; reload cannot bypass', async () => {
    const h = await setup('- [ ] A <!-- openteam: {"id":"a","executable":true} -->\n- [ ] B <!-- openteam: {"id":"b","dependsOn":["a"],"executable":true} -->')
    await h.invoke('GROUP_PROJECT_EXECUTE')
    await h.deliver('a')
    await h.readiness('b', 'b', { dependencies: [] })
    expect((await h.getStore()).projectsById!.p.status).toBe('blocked')
    const workerBPrompts = vi.mocked(h.deps.sendPrompt).mock.calls.filter(([delivery]) => delivery.roleId === 'b')
    expect(workerBPrompts).toHaveLength(0)
    const sends = vi.mocked(h.deps.sendPrompt).mock.calls.length
    h.reload()
    await h.pump()
    expect(h.deps.sendPrompt).toHaveBeenCalledTimes(sends)
  })
  it('rejects plan PASS without verified original coverage and sends no worker assignment', async () => {
    const h = await setup('- [ ] Service')
    await h.invoke('GROUP_PROJECT_EXECUTE')
    const source = await h.reply('manager', '{"phases":[{"title":"Partial","instruction":"Build","acceptance":"Tests"}]}')
    await h.acceptPlan('todo-1', source, { coverageVerified: false })
    const project = (await h.getStore()).projectsById!.p
    expect(project.status).toBe('blocked')
    expect(project.nodes).toHaveLength(1)
    expect(h.deps.sendPrompt).toHaveBeenCalledTimes(2)
  })
  it('reworks rejected plans within the original task and bound', async () => {
    const h = await setup('- [ ] Service')
    await h.invoke('GROUP_PROJECT_EXECUTE')
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await h.reply('manager', '{"phases":[{"title":"Partial","instruction":"Build","acceptance":"Tests"}]}')
      await h.reply('reviewer', JSON.stringify({ decision: 'fail', reason: 'Original acceptance omitted', failedCriteria: ['coverage'], nextRoundInstruction: 'Cover the original requirement' }))
    }
    const project = (await h.getStore()).projectsById!.p
    expect(project.status).toBe('blocked')
    expect(project.nodes).toHaveLength(1)
    expect(projectSummary(project).progressPercent).toBe(0)
    expect(h.deps.sendPrompt).toHaveBeenCalledTimes(6)
  })
  it('keeps REWORK on the same phase and never increases accepted progress', async () => {
    const h = await setup('- [ ] Service <!-- openteam: {"executable":true} -->\n- [ ] Viewer')
    await h.invoke('GROUP_PROJECT_EXECUTE')
    await h.readiness('todo-1')
    await h.reply('a', 'Delivery')
    await h.reply('reviewer', JSON.stringify({ decision: 'fail', reason: 'Integration fails', failedCriteria: ['integration'], nextRoundInstruction: 'Repair integration' }))
    const project = (await h.getStore()).projectsById!.p
    expect(project.activeNodeId).toBe('todo-1')
    expect(project.nodes[0].status).toBe('rework')
    expect(projectSummary(project).progressPercent).toBe(0)
    await h.deliver('todo-1')
    expect((await h.getStore()).projectsById!.p.activeNodeId).toBe('todo-2')
  })
  it('automatically plans phases, accepts each, advances to the next TODO and completes; reload never duplicates sends', async () => {
    const h = await setup('- [ ] Service\n- [ ] Viewer <!-- openteam: {"executable":true} -->')
    await h.invoke('GROUP_PROJECT_EXECUTE')
    expect(h.deps.sendPrompt).toHaveBeenCalledTimes(1)
    h.reload()
    await Promise.all([h.pump(), h.pump()])
    expect(h.deps.sendPrompt).toHaveBeenCalledTimes(1)
    const planMessageId = await h.reply('manager', JSON.stringify({ phases: [{ title: 'Contract', instruction: 'Build contract', acceptance: 'Contract tests' }, { title: 'Integration', instruction: 'Integrate', acceptance: 'Integrated service tests' }] }))
    expect((await h.getStore()).projectsById!.p.nodes).toHaveLength(2)
    await h.acceptPlan('todo-1', planMessageId)
    await h.deliver('todo-1/phase-1')
    expect(projectSummary((await h.getStore()).projectsById!.p).progressPercent).toBe(25)
    h.reload()
    await h.pump()
    await h.deliver('todo-1/phase-2')
    const halfway = (await h.getStore()).projectsById!.p
    expect(halfway.activeNodeId).toBe('todo-2')
    expect(projectSummary(halfway).progressPercent).toBe(50)
    await h.deliver('todo-2', 'b')
    const final = (await h.getStore()).projectsById!.p
    expect(final.status).toBe('completed')
    expect(projectSummary(final).progressPercent).toBe(100)
    const sends = vi.mocked(h.deps.sendPrompt).mock.calls.length
    h.reload()
    await h.pump()
    expect(h.deps.sendPrompt).toHaveBeenCalledTimes(sends)
  })
  it('blocks malformed planning and cannot bypass the block with execute/resume', async () => {
    const h = await setup('- [ ] Service')
    await h.invoke('GROUP_PROJECT_EXECUTE')
    const planMessageId = await h.reply('manager', 'Done')
    await h.acceptPlan('todo-1', planMessageId)
    expect((await h.getStore()).projectsById!.p.status).toBe('blocked')
    await expect(h.invoke('GROUP_PROJECT_EXECUTE')).rejects.toThrow()
    await expect(h.invoke('GROUP_PROJECT_WORKSPACE_RESUME')).rejects.toThrow('Only paused')
    expect(h.deps.sendPrompt).toHaveBeenCalledTimes(2)
  })
  it('does not dispatch permission-gated work', async () => {
    const h = await setup('- [ ] Install native service <!-- openteam: {"requiresApproval":true} -->')
    await h.invoke('GROUP_PROJECT_EXECUTE')
    expect((await h.getStore()).projectsById!.p.reason).toContain('approval')
    expect(h.deps.sendPrompt).not.toHaveBeenCalled()
  })
  it('pause/resume preserves the original prompt and late source response', async () => {
    const h = await setup('- [ ] Service')
    await h.invoke('GROUP_PROJECT_EXECUTE')
    await h.invoke('GROUP_PROJECT_WORKSPACE_PAUSE')
    await h.reply('manager', '{"phases":[{"title":"Contract","instruction":"Build","acceptance":"Tests"}]}')
    expect(h.deps.sendPrompt).toHaveBeenCalledTimes(1)
    await h.invoke('GROUP_PROJECT_WORKSPACE_RESUME')
    expect(h.deps.sendPrompt).toHaveBeenCalledTimes(2)
    expect((await h.getStore()).projectsById!.p.activeNodeId).toBe('todo-1')
  })
  it('reimport is idempotent and preserves changed source as an explicit conflict', async () => {
    const h = await setup('- [ ] Service')
    await h.invoke('GROUP_PROJECT_IMPORT_TODO', { project: input('- [ ] Service') })
    await expect(h.invoke('GROUP_PROJECT_IMPORT_TODO', { project: input('- [ ] Different') })).rejects.toThrow('different TODO')
    expect((await h.getStore()).projectsById!.p.nodes[0].title).toBe('Service')
  })
})
