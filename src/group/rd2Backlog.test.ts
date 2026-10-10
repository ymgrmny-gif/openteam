import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ancestorIds, nextProjectTask, importProjectTodo } from './projectWorkspace'

const todo = readFileSync(new URL('../../docs/RD2_CURRENT_BACKLOG_20261010.md', import.meta.url), 'utf8')
const project = () => importProjectTodo({ id: 'rd2', chatId: 'c', name: 'RD2', goals: 'Scoped development', sourcePath: 'DEVELOPMENT_BACKLOG.md', todo, managerRoleId: 'm', reviewerRoleId: 'r', engineers: [{ roleId: 'a', branch: 'codex/a', worktree: 'C:/work/a' }] }, 1)

describe('RD2 development backlog boundaries', () => {
  it('has finite unique acyclic cards and separates native permissions from safe development', () => {
    const p = project()
    const tasks = p.nodes.filter(node => node.kind === 'task')
    expect(tasks.length).toBeGreaterThan(25)
    expect(tasks.length).toBeLessThan(60)
    for (const node of tasks) {
      expect(node.requiresApproval).toBe(node.acceptanceLevel === 'native')
      expect(ancestorIds(p, node).some(id => p.nodes.find(item => item.id === id)!.requiresApproval)).toBe(false)
    }
  })
  it('allows browser source and live-profile acceptance without waiting for native Screen Control', () => {
    const p = project()
    const dependencies = (id: string): string[] => p.nodes.find(node => node.id === id)!.dependsOn.flatMap(dep => [dep, ...dependencies(dep)])
    for (const id of ['browser-design', 'browser-code', 'browser-tests', 'browser-native']) expect(dependencies(id).some(dep => dep.startsWith('input-'))).toBe(false)
    expect(dependencies('browser-native')).toContain('auth-native')
    expect(dependencies('capture-native')).toContain('auth-native')
    expect(dependencies('input-native')).toContain('viewer-native')
  })
  it('continues ready safe work when a device card needs approval', () => {
    const p = project()
    for (const id of ['pre-02-d', 'pre-02-f', 'pre-02-i', 'svc-design', 'svc-code', 'svc-tests']) {
      const node = p.nodes.find(item => item.id === id)!
      node.status = 'accepted'
      node.evidence = ['Synthetic fixture of accepted scoped work']
    }
    expect(p.nodes.find(node => node.id === 'svc-native')!.requiresApproval).toBe(true)
    expect(nextProjectTask(p)?.id).toBe('auth-design')
  })
})
