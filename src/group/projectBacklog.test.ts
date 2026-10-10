import { describe, expect, it } from 'vitest'
import { compileProjectBacklog } from './projectBacklog'

const task = { id: 'one', instruction: 'Implement utility', acceptance: 'Real tests pass', ownerRoleId: 'a', branch: 'codex/a', worktree: 'C:/work/a' }
const input = { id: 'project', chatId: 'chat', managerRoleId: 'manager', reviewerRoleId: 'reviewer', tasks: [task] }

describe('finite project backlog', () => {
  it('compiles acceptance and repair edges with bounded execution', () => {
    const flow = compileProjectBacklog({ ...input, tasks: [task, { ...task, id: 'two', dependsOn: ['one'], ownerRoleId: 'b', branch: 'codex/b', worktree: 'C:/work/b' }] }, 1)
    expect(flow.stages).toHaveLength(6)
    expect(flow.maxNodeExecutions).toBe(18)
    expect(flow.graph?.edges).toContainEqual({ sourceStageId: 'task-0-review', sourcePort: 'pass', targetStageId: 'task-1-manager' })
    expect(flow.graph?.edges).toContainEqual({ sourceStageId: 'task-0-review', sourcePort: 'fail', targetStageId: 'task-0-manager' })
  })

  it.each([
    { tasks: [] },
    { tasks: [task, task] },
    { tasks: [{ ...task, dependsOn: ['missing'] }] },
    { tasks: [{ ...task, ownerRoleId: 'reviewer' }] },
    { tasks: [{ ...task, requiresApproval: true }] },
    { tasks: [{ ...task, worktree: 'C:/work/../main' }] },
    { tasks: [task, { ...task, id: 'two', ownerRoleId: 'b', branch: 'codex/b', worktree: 'c:\\WORK\\a\\' }] },
    { tasks: [task, { ...task, id: 'two', ownerRoleId: 'b', worktree: 'C:/work/b' }] },
    { maxAttempts: 20 },
  ])('rejects invalid dependencies, ownership, unbounded and approval-required input: %j', patch => {
    expect(() => compileProjectBacklog({ ...input, ...patch }, 1)).toThrow()
  })
})
