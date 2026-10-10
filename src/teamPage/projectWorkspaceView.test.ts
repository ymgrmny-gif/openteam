// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createDefaultStore } from '../group/store'
import { importProjectTodo } from '../group/projectWorkspace'
import { createProjectWorkspaceView } from './projectWorkspaceView'

function fixture() {
  const store = createDefaultStore()
  store.settings.language = 'en'
  const project = importProjectTodo({ id: 'p', chatId: 'chat', name: 'Service', goals: 'Safe scope', sourcePath: 'TODO.md', todo: '# Windows\n- [ ] Contract\n  - [x] Unit test', managerRoleId: 'm', reviewerRoleId: 'r', engineers: [{ roleId: 'a', branch: 'codex/a', worktree: 'C:/work/a' }] }, 1)
  store.projectsById = { p: project }
  const chat = { id: 'chat', name: 'Room', mode: 'independent' as const, roleIds: [], messageIds: [], nextMessageSeq: 1, status: 'ready' as const, createdAt: 1, updatedAt: 1 }
  const openButton = document.createElement('button')
  const modal = document.createElement('div')
  const content = document.createElement('div')
  modal.append(content)
  document.body.replaceChildren(openButton, modal)
  const runCommand = vi.fn(async () => undefined)
  const view = createProjectWorkspaceView({ openButton, modal, content, getStore: () => store, getCurrentChat: () => chat, getRoles: () => [], runCommand, showError: vi.fn() })
  view.registerEvents()
  view.render()
  return { project, content, view, runCommand }
}

describe('project workspace view', () => {
  it('shows expandable hierarchy, historical marks and verified evidence safely', () => {
    const h = fixture()
    expect(h.content.querySelectorAll('[data-task-id]')).toHaveLength(3)
    expect(h.content.textContent).toContain('independent acceptance required')
    expect(h.content.querySelector('progress')?.value).toBe(0)
    h.project.nodes[2].status = 'accepted'
    h.project.nodes[2].evidence = ['<script>unsafe</script>', 'Tests exit 0']
    h.view.render()
    expect(h.content.querySelector('progress')?.value).toBe(100)
    expect(h.content.textContent).toContain('Tests exit 0')
    expect(h.content.querySelector('script')).toBeNull()
  })
  it('starts only on explicit action and exposes the blocked reason without replay controls', async () => {
    const h = fixture()
    expect(h.runCommand).not.toHaveBeenCalled()
    const start = [...h.content.querySelectorAll('button')].find(button => button.textContent === 'Start')!
    start.click()
    await Promise.resolve()
    expect(h.runCommand).toHaveBeenCalledWith('GROUP_PROJECT_EXECUTE', { projectId: 'p' })
    h.project.status = 'blocked'
    h.project.reason = 'Native permission required'
    h.view.render()
    expect(h.content.textContent).toContain('Native permission required')
    expect([...h.content.querySelectorAll('button')].some(button => ['Start', 'Resume', 'Retry'].includes(button.textContent ?? ''))).toBe(false)
  })
})
