import type { OrchestrationFlow, OrchestrationGraphEdge, OrchestrationStage, ProjectBacklog, ProjectBacklogTask } from './types'

// Compile a finite, user-owned backlog into the existing durable graph runtime.
// Serial execution is intentional: there is exactly one writer lease per project.
export function compileProjectBacklog(raw: unknown, now: number): OrchestrationFlow {
  const input = record(raw)
  const id = string(input.id, 'project id')
  const chatId = string(input.chatId, 'chatId')
  const managerRoleId = string(input.managerRoleId, 'managerRoleId')
  const reviewerRoleId = string(input.reviewerRoleId, 'reviewerRoleId')
  const maxAttempts = input.maxAttempts ?? 3
  if (!Number.isInteger(maxAttempts) || Number(maxAttempts) < 1 || Number(maxAttempts) > 5) throw new Error('maxAttempts must be 1..5')
  if (!Array.isArray(input.tasks) || !input.tasks.length || input.tasks.length * 3 * Number(maxAttempts) > 200) throw new Error('A finite backlog within 200 node executions is required')
  const seen = new Set<string>()
  const ownership = new Map<string, string>()
  const tasks: ProjectBacklogTask[] = input.tasks.map(rawTask => {
    const task = record(rawTask)
    const taskId = string(task.id, 'task id')
    if (seen.has(taskId)) throw new Error(`Duplicate task: ${taskId}`)
    const dependsOn = task.dependsOn ?? []
    if (!Array.isArray(dependsOn) || dependsOn.some(dep => typeof dep !== 'string' || !seen.has(dep))) throw new Error(`Dependencies must precede task ${taskId}`)
    const ownerRoleId = string(task.ownerRoleId, 'ownerRoleId')
    if (new Set([managerRoleId, reviewerRoleId, ownerRoleId]).size !== 3) throw new Error('Manager, writer and independent reviewer must be distinct')
    const branch = string(task.branch, 'branch')
    const worktree = string(task.worktree, 'worktree')
    if (!branch.startsWith('codex/') || !/^(?:[A-Za-z]:[\\/]|\/)/.test(worktree) || /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(worktree)) throw new Error('Use an isolated codex/ branch and absolute worktree without traversal')
    for (const resource of [`branch:${branch.toLowerCase()}`, `worktree:${worktree.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()}`]) {
      if (ownership.has(resource) && ownership.get(resource) !== ownerRoleId) throw new Error(`Single-writer ownership conflict: ${resource}`)
      ownership.set(resource, ownerRoleId)
    }
    if (task.requiresApproval === true) throw new Error(`BLOCKED: task ${taskId} requires user approval; do not submit until authorized`)
    seen.add(taskId)
    return { id: taskId, instruction: string(task.instruction, 'instruction'), acceptance: string(task.acceptance, 'acceptance'), ownerRoleId, branch, worktree, dependsOn: dependsOn as string[] }
  })
  const project: ProjectBacklog = { id, chatId, managerRoleId, reviewerRoleId, tasks, maxAttempts: Number(maxAttempts) }
  const stages: OrchestrationStage[] = []
  const edges: OrchestrationGraphEdge[] = []
  for (const [index, task] of tasks.entries()) {
    const manager = `task-${index}-manager`
    const worker = `task-${index}-worker`
    const review = `task-${index}-review`
    const scope = `Task ${task.id}\n${task.instruction}\nAcceptance: ${task.acceptance}\nSole writer: ${task.ownerRoleId}\nBranch: ${task.branch}\nWorktree: ${task.worktree}`
    const boundary = 'Use only the authorized task scope and assigned isolated worktree. Never change production, credentials, native/OS state, upstream repositories or push/merge. If approval or unavailable tools block execution, return JSON {"blocked":true,"reason":"specific reason"}. Do not create follow-up tasks or send prompts yourself.'
    stages.push(
      { id: manager, kind: 'roles', name: `${task.id}: Manager`, roleIds: [managerRoleId], projectTaskId: task.id, description: `${scope}\n${boundary}\nPrepare a concrete assignment for the sole writer; check dependency acceptance and prior reviewer feedback. Return the assignment in your completed response. The runtime dispatches it.` },
      { id: worker, kind: 'roles', name: `${task.id}: Worker`, roleIds: [task.ownerRoleId], projectTaskId: task.id, description: `${scope}\n${boundary}\nPerform the assignment, run acceptance tests, read back sources and Git state. Return completed delivery with file paths, test commands/exit codes, commit SHA and limitations. Intent or claimed success without source evidence is insufficient.` },
      { id: review, kind: 'review', name: `${task.id}: Independent review`, roleIds: [], projectTaskId: task.id, description: `${scope}\n${boundary}`, review: { reviewerRoleIds: [reviewerRoleId], maxAttempts: Number(maxAttempts), onMaxAttempts: 'stop', instructions: 'Independently read the actual files, rerun acceptance tests and verify branch/worktree ownership and Git evidence. PASS only for fully verified acceptance; otherwise fail (REWORK). Alongside the normal review JSON include taskId, workerMessageId (the exact source delivery below), verified:true and evidence:[non-empty source/test/Git readback strings] on pass. Never accept intent, partial/scoped PASS or synthetic evidence as full completion.' } },
    )
    edges.push({ sourceStageId: manager, targetStageId: worker }, { sourceStageId: worker, targetStageId: review }, { sourceStageId: review, sourcePort: 'fail', targetStageId: manager })
    if (index < tasks.length - 1) edges.push({ sourceStageId: review, sourcePort: 'pass', targetStageId: `task-${index + 1}-manager` })
  }
  return { id: `project-${id}`, chatId, name: `Project: ${id}`, description: 'User-defined finite backlog', project, stages, graph: { stageNodes: stages, edges }, maxNodeExecutions: tasks.length * 3 * Number(maxAttempts), maxRounds: 1, createdAt: now, updatedAt: now }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Project/task must be an object')
  return value as Record<string, unknown>
}

function string(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing ${field}`)
  return value.trim()
}
