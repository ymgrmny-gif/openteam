import { describe, expect, it } from 'vitest'
import { applyManagerBreakdown, importProjectTodo, nextProjectTask, parseProjectTodo, projectSummary } from './projectWorkspace'

export const workspaceInput = (todo = '# Service\n- [x] Windows service\n- [ ] Viewer') => ({
  id: 'p', chatId: 'chat-1', name: 'Example', goals: 'Reliable modular product',
  sourcePath: 'TODO.md', todo, managerRoleId: 'manager', reviewerRoleId: 'reviewer',
  engineers: [{ roleId: 'a', branch: 'codex/a', worktree: 'C:/work/a' }, { roleId: 'b', branch: 'codex/b', worktree: 'C:/work/b' }],
})

describe('project workspace', () => {
  it('imports nested tasks and treats checked boxes as historical', () => {
    const project = importProjectTodo(workspaceInput('# Service\n- [x] Host\n  - [ ] Contract\n~~~\n- [ ] example\n~~~\n## Native\n- [ ] SCM'), 1)
    expect(project.nodes.map(node => node.title)).toEqual(['Service', 'Host', 'Contract', 'Native', 'SCM'])
    expect(project.nodes[2].parentId).toBe(project.nodes[1].id)
    expect(project.nodes[1].sourceChecked).toBe(true)
    expect(projectSummary(project).progressPercent).toBe(0)
    expect(nextProjectTask(project)?.title).toBe('Contract')
  })
  it('requires independent evidence and computes weighted progress', () => {
    const project = importProjectTodo(workspaceInput('- [ ] A <!-- openteam: {"id":"a","weight":3} -->\n- [ ] B <!-- openteam: {"id":"b","dependsOn":["a"]} -->'), 1)
    project.nodes[0].status = 'accepted'
    expect(projectSummary(project).accepted).toBe(0)
    expect(nextProjectTask(project)).toBeUndefined()
    project.nodes[0].evidence = ['Independent source/test/Git proof']
    expect(projectSummary(project).progressPercent).toBe(75)
    expect(nextProjectTask(project)?.id).toBe('b')
  })
  it('creates bounded serial phases, keeps the writer, and requires final integration', () => {
    const project = importProjectTodo(workspaceInput('- [ ] Service'), 1)
    const parent = project.nodes[0]
    parent.ownerRoleId = 'a'
    applyManagerBreakdown(project, parent, JSON.stringify({ phases: [
      { title: 'Contract', instruction: 'Implement contract', acceptance: 'Contract tests' },
      { title: 'Integration', instruction: 'Verify original', acceptance: 'Integration tests' },
    ] }), 2)
    const phases = project.nodes.slice(1)
    expect(phases.map(node => node.ownerRoleId)).toEqual(['a', 'a'])
    expect(phases[1].dependsOn).toEqual([phases[0].id])
    expect(phases[1].acceptance).toContain(parent.acceptance)
    expect(phases[0].acceptance).toContain('parent task remains open')
    phases[0].status = 'accepted'
    phases[0].evidence = ['verified']
    expect(projectSummary(project).progressPercent).toBe(50)
    expect(nextProjectTask(project)?.id).toBe(phases[1].id)
    expect(() => applyManagerBreakdown(project, parent, '{"phases":[]}', 3)).toThrow('1..8')
    expect(() => applyManagerBreakdown(project, parent, JSON.stringify({ phases: Array(9).fill({}) }), 3)).toThrow('1..8')
  })
  it('rejects missing, duplicate and cyclic dependencies', () => {
    expect(() => parseProjectTodo('- [ ] A <!-- openteam: {"id":"a","dependsOn":["b"]} -->', 1)).toThrow('Missing dependency')
    expect(() => parseProjectTodo('- [ ] A <!-- openteam: {"id":"a","dependsOn":["a"]} -->', 1)).toThrow('Cyclic')
    expect(() => parseProjectTodo('- [ ] A <!-- openteam: {"id":"a"} -->\n- [ ] B <!-- openteam: {"id":"a"} -->', 1)).toThrow('Duplicate')
    expect(() => parseProjectTodo('- [ ] A <!-- openteam: {bad} -->', 1)).toThrow('metadata')
  })
  it('holds approval boundaries on ancestors and Manager phases', () => {
    const project = importProjectTodo(workspaceInput('# OS <!-- openteam: {"requiresApproval":true} -->\n- [ ] Install service'), 1)
    expect(nextProjectTask(project)).toBeUndefined()
    const ordinary = importProjectTodo(workspaceInput('- [ ] Service'), 1)
    applyManagerBreakdown(ordinary, ordinary.nodes[0], '{"phases":[{"title":"Install","instruction":"SCM install","acceptance":"Native test","requiresApproval":true}]}', 2)
    expect(nextProjectTask(ordinary)).toBeUndefined()
    expect(projectSummary(ordinary).nodes[0].status).toBe('approval')
  })
})
