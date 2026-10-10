import { describe, expect, it } from 'vitest'
import { importProjectTodo } from './projectWorkspace'
import { executionForNode, validateArtifact, validateReadiness } from './projectExecutionGate'
import type { ProjectBacklogTask } from './types'

const base = 'a'.repeat(40)
const dependency = 'b'.repeat(40)
const input = { id: 'p', chatId: 'c', name: 'RD2', goals: 'Authorized scoped work', sourcePath: 'CURRENT.md', todo: '- [ ] A <!-- openteam: {"id":"a","executable":true} -->\n- [ ] B <!-- openteam: {"id":"b","dependsOn":["a"],"executable":true} -->', managerRoleId: 'm', reviewerRoleId: 'r', engineers: [{ roleId: 'w', branch: 'codex/w', worktree: 'C:/work/w' }], execution: { baseCommit: base, allowedPaths: { w: ['src/module'] } } }
const task: ProjectBacklogTask = { id: 'b', ownerRoleId: 'w', branch: 'codex/w', worktree: 'C:/work/w', instruction: 'Scoped work', acceptance: 'Tests', dependsOn: ['a'], execution: { baseCommit: base, allowedPaths: ['src/module'], acceptanceLevel: 'source', traceability: ['D01', 'F01'], dependencies: [{ taskId: 'a', commit: dependency }] } }
const readiness = () => ({ readiness: { baseCommit: base, headCommit: base, branch: task.branch, worktree: task.worktree, clean: true, baseIsAncestor: true, allowedPaths: ['src/module'], dependencies: [{ taskId: 'a', commit: dependency, isAncestor: true }] } })
const proof = () => ({ artifact: { baseCommit: base, commit: 'c'.repeat(40), branch: task.branch, worktree: task.worktree, changedPaths: ['src/module/index.ts'], acceptanceLevel: 'source' } })

describe('project execution gates', () => {
  it('requires commit artifacts even for an accepted dependency', () => {
    const project = importProjectTodo(input, 1)
    project.nodes[0].status = 'accepted'
    project.nodes[0].evidence = ['Scoped tests passed']
    project.nodes[1].ownerRoleId = 'w'
    expect(() => executionForNode(project, project.nodes[1])).toThrow('no verified commit')
    project.nodes[0].artifact = proof().artifact as NonNullable<typeof project.nodes[0]['artifact']>
    expect(executionForNode(project, project.nodes[1]).dependencies).toEqual([{ taskId: 'a', commit: 'c'.repeat(40) }])
  })
  it('rejects a consumer missing the accepted commit or based on the wrong checkout', () => {
    expect(() => validateReadiness(readiness(), task)).not.toThrow()
    for (const changed of [{ dependencies: [] }, { dependencies: [{ taskId: 'a', commit: dependency, isAncestor: false }] }, { dependencies: [{ taskId: 'a', commit: 'd'.repeat(40), isAncestor: true }] }, { clean: false }, { baseIsAncestor: false }, { branch: 'main' }, { worktree: 'C:/production' }, { headCommit: 'short' }, { allowedPaths: ['src'] }]) {
      expect(() => validateReadiness({ readiness: { ...readiness().readiness, ...changed } }, task)).toThrow('Readiness')
    }
  })
  it('rejects unowned paths, traversal, fake SHA and wrong acceptance level', () => {
    expect(() => validateArtifact(proof(), task)).not.toThrow()
    for (const changed of [{ changedPaths: ['src/other/index.ts'] }, { changedPaths: ['src/module/../other.ts'] }, { changedPaths: ['.git/config'] }, { commit: 'claimed-success' }, { baseCommit: dependency }, { branch: 'main' }, { changedPaths: [] }, { acceptanceLevel: 'contract' }]) {
      expect(() => validateArtifact({ artifact: { ...proof().artifact, ...changed } }, task)).toThrow()
    }
  })
  it('never accepts synthetic evidence for native requirements', () => {
    const nativeTask = { ...task, execution: { ...task.execution!, acceptanceLevel: 'native' as const } }
    const nativeProof = { artifact: { ...proof().artifact, acceptanceLevel: 'native' } }
    expect(() => validateArtifact(nativeProof, nativeTask)).toThrow('real OS/device')
    expect(() => validateArtifact({ ...nativeProof, nativeVerified: true }, nativeTask)).not.toThrow()
  })
  it('rejects overlapping ownership and invalid execution baselines at import', () => {
    expect(() => importProjectTodo({ ...input, execution: { ...input.execution, baseCommit: 'short' } }, 1)).toThrow('full lowercase')
    expect(() => importProjectTodo({ ...input, engineers: [...input.engineers, { roleId: 'w2', branch: 'codex/w2', worktree: 'C:/work/w2' }], execution: { baseCommit: base, allowedPaths: { w: ['src/module'], w2: ['src/module/child'] } } }, 1)).toThrow('nonoverlapping')
  })
  it('inherits native acceptance and requirement traceability from parent groups', () => {
    const project = importProjectTodo({ ...input, todo: '# Native <!-- openteam: {"acceptanceLevel":"native","traceability":["F12"]} -->\n- [ ] Service <!-- openteam: {"executable":true} -->' }, 1)
    project.nodes[1].ownerRoleId = 'w'
    expect(executionForNode(project, project.nodes[1])).toMatchObject({ acceptanceLevel: 'native', traceability: ['F12'] })
  })
})
