import type { GroupChat, GroupRole, OpenTeamStore, ProjectWorkspace, ProjectTaskNode, ProjectNodeStatus } from '../group/types'
import { projectNodeProgress, projectSummary } from '../group/projectWorkspace'

interface Dependencies {
  openButton: HTMLButtonElement
  modal: HTMLElement
  content: HTMLElement
  getStore(): OpenTeamStore
  getCurrentChat(): GroupChat | undefined
  getRoles(): GroupRole[]
  runCommand(type: string, payload?: Record<string, unknown>): Promise<void>
  showError(message: string): void
}

const labels = {
  tr: { project: 'Proje', close: 'Kapat', title: 'Proje ve görevler', empty: 'Bu oda için proje yok. TODO dosyasını ve hedefi ekleyin.', import: 'TODO’dan proje oluştur', name: 'Proje adı', goals: 'Hedef ve yetkili geliştirme kapsamı', todo: 'TODO.md dosyası', source: 'Kaynak adı / yolu', manager: 'Manager', reviewer: 'Bağımsız Reviewer', engineers: 'Mühendisler ve izole çalışma alanları', branch: 'Branch', worktree: 'Worktree', save: 'İçe aktar', start: 'Başlat', pause: 'Duraklat', resume: 'Devam et', accepted: 'Kabul edildi', remaining: 'Açık', evidence: 'Kabul kanıtları', criteria: 'Kabul koşulları', dependencies: 'Bağımlılıklar', history: 'Geçmiş', unchecked: 'TODO’da işaretli; bağımsız kabul bekliyor', noChat: 'Önce bir oda seçin.', gate: 'İzin gerektiren işler otomatik yürütülmez. İçe aktarma işlemi çalışmayı başlatmaz.', sourceLine: 'TODO satırı', states: { open: 'Açık', planning: 'Manager aşamaları hazırlıyor', queued: 'Sırada', running: 'Çalışıyor', review: 'İncelemede', rework: 'Düzeltme', accepted: 'Kabul edildi', blocked: 'Engelli', approval: 'İzin bekliyor', draft: 'Hazır', paused: 'Duraklatıldı', completed: 'Tamamlandı' } },
  en: { project: 'Project', close: 'Close', title: 'Project and tasks', empty: 'No project in this chat. Add a TODO file and goals.', import: 'Create project from TODO', name: 'Project name', goals: 'Goals and authorized development scope', todo: 'TODO.md file', source: 'Source name / path', manager: 'Manager', reviewer: 'Independent Reviewer', engineers: 'Engineers and isolated workspaces', branch: 'Branch', worktree: 'Worktree', save: 'Import', start: 'Start', pause: 'Pause', resume: 'Resume', accepted: 'Accepted', remaining: 'Open', evidence: 'Acceptance evidence', criteria: 'Acceptance criteria', dependencies: 'Dependencies', history: 'History', unchecked: 'Checked in TODO; independent acceptance required', noChat: 'Select a chat first.', gate: 'Approval-required work is not executed automatically. Import does not start work.', sourceLine: 'TODO line', states: { open: 'Open', planning: 'Manager planning phases', queued: 'Queued', running: 'Running', review: 'In review', rework: 'Rework', accepted: 'Accepted', blocked: 'Blocked', approval: 'Needs approval', draft: 'Ready', paused: 'Paused', completed: 'Completed' } },
  'zh-CN': { project: '项目', close: '关闭', title: '项目与任务', empty: '当前群聊暂无项目，请添加 TODO 和目标。', import: '从 TODO 创建项目', name: '项目名称', goals: '目标与授权开发范围', todo: 'TODO.md 文件', source: '来源名称 / 路径', manager: '管理者', reviewer: '独立复核者', engineers: '工程师与隔离工作区', branch: '分支', worktree: '工作树', save: '导入', start: '开始', pause: '暂停', resume: '继续', accepted: '已验收', remaining: '待完成', evidence: '验收证据', criteria: '验收标准', dependencies: '依赖任务', history: '历史', unchecked: 'TODO 已勾选；仍需独立验收', noChat: '请先选择群聊。', gate: '需要授权的任务不会自动执行。导入不会启动任务。', sourceLine: 'TODO 行', states: { open: '待处理', planning: '管理者规划阶段', queued: '排队', running: '执行中', review: '复核中', rework: '返工', accepted: '已验收', blocked: '阻塞', approval: '等待授权', draft: '就绪', paused: '已暂停', completed: '已完成' } },
}

export function createProjectWorkspaceView(deps: Dependencies) {
  let selectedId: string | undefined
  let form: HTMLFormElement | undefined
  let formChatId: string | undefined
  let pending = false
  const expanded = new Set<string>()
  const copy = () => labels[deps.getStore().settings.language]
  const act = async (type: string, payload: Record<string, unknown>) => {
    if (pending) return
    pending = true
    render()
    try { await deps.runCommand(type, payload) } catch (error) { deps.showError(error instanceof Error ? error.message : String(error)) }
    finally { pending = false; render() }
  }

  function render(): void {
    const text = copy()
    deps.openButton.textContent = text.project
    if (deps.modal.hidden) return
    const header = element('div', undefined, 'modal-header')
    const title = element('h2', text.title)
    title.id = 'project-workspace-title'
    header.append(title, button(text.close, () => { deps.modal.hidden = true }))
    const chat = deps.getCurrentChat()
    if (!chat) { deps.content.replaceChildren(header, element('p', text.noChat)); return }
    const projects = Object.values(deps.getStore().projectsById ?? {}).filter(project => project.chatId === chat.id)
    const navigation = element('div', undefined, 'project-workspace-navigation')
    for (const project of projects) navigation.append(button(project.name, () => { selectedId = project.id; render() }))
    const selected = projects.find(project => project.id === selectedId) ?? projects[0]
    const body = selected ? renderProject(selected) : element('p', text.empty)
    if (formChatId !== chat.id) { form = undefined; formChatId = chat.id }
    form ??= createImportForm(chat)
    const create = document.createElement('details')
    create.className = 'project-workspace-import'
    create.open = !selected
    create.append(element('summary', text.import), form)
    deps.content.replaceChildren(header, navigation, body, create)
  }

  function renderProject(project: ProjectWorkspace): HTMLElement {
    const text = copy()
    const panel = element('section', undefined, 'project-workspace-panel')
    const summary = projectSummary(project)
    panel.append(element('h3', project.name), element('p', project.goals), element('p', `${text.states[project.status]} · ${summary.progressPercent}% · ${text.accepted}: ${summary.accepted}/${summary.total} · ${text.remaining}: ${summary.open}`))
    const progress = document.createElement('progress')
    progress.max = 100
    progress.value = summary.progressPercent
    progress.setAttribute('aria-label', `${project.name}: ${summary.progressPercent}%`)
    panel.append(progress, element('p', project.sourcePath, 'project-workspace-source'))
    if (project.reason) panel.append(element('p', project.reason, 'project-workspace-blocked'))
    const controls = element('div', undefined, 'project-workspace-actions')
    if (project.status === 'draft') controls.append(button(text.start, () => { void act('GROUP_PROJECT_EXECUTE', { projectId: project.id }) }, pending))
    if (project.status === 'running') controls.append(button(text.pause, () => { void act('GROUP_PROJECT_WORKSPACE_PAUSE', { projectId: project.id }) }, pending))
    if (project.status === 'paused') controls.append(button(text.resume, () => { void act('GROUP_PROJECT_WORKSPACE_RESUME', { projectId: project.id }) }, pending))
    panel.append(controls)
    for (const root of project.nodes.filter(node => !node.parentId)) panel.append(renderNode(project, root))
    return panel
  }

  function renderNode(project: ProjectWorkspace, node: ProjectTaskNode): HTMLElement {
    const text = copy()
    const state = projectNodeProgress(project, node.id)
    const details = document.createElement('details')
    details.className = `project-task project-task-${state.status}`
    details.dataset.taskId = node.id
    const key = `${project.id}/${node.id}`
    details.open = expanded.has(key)
    details.addEventListener('toggle', () => { if (details.open) expanded.add(key); else expanded.delete(key) })
    const owner = node.ownerRoleId ? deps.getStore().rolesById[node.ownerRoleId]?.name ?? node.ownerRoleId : undefined
    const row = element('summary', `${node.title} · ${text.states[state.status]} · ${Math.floor(state.fraction * 100)}%${owner ? ` · ${owner}` : ''}`)
    details.append(row)
    const description = element('div', undefined, 'project-task-detail')
    description.append(element('p', node.instruction), element('h4', text.criteria), element('p', node.acceptance))
    if (node.sourceLine) description.append(element('p', `${text.sourceLine}: ${node.sourceLine}`))
    if (node.sourceChecked && state.status !== 'accepted') description.append(element('p', text.unchecked))
    if (node.reason) description.append(element('p', node.reason, 'project-workspace-blocked'))
    if (node.dependsOn.length) description.append(element('p', `${text.dependencies}: ${node.dependsOn.map(id => project.nodes.find(item => item.id === id)?.title ?? id).join(', ')}`))
    if (node.evidence?.length) {
      description.append(element('h4', text.evidence))
      const proof = element('ul')
      for (const evidence of node.evidence) proof.append(element('li', evidence))
      description.append(proof)
    }
    description.append(element('h4', text.history))
    const history = element('ol')
    for (const event of node.events) history.append(element('li', `${new Date(event.at).toLocaleString()} · ${text.states[event.status as ProjectNodeStatus]}${event.reason ? ` · ${event.reason}` : ''}`))
    description.append(history)
    if (node.runId) {
      const run = deps.getStore().orchestrationRunsById[node.runId]
      for (const stage of run?.stageRuns ?? []) {
        for (const role of Object.values(stage.roleRuns)) {
          const source = Object.values(deps.getStore().messagesById).find(message => message.type === 'assistant' && message.roleId === role.roleId && message.sourceMessageId === role.messageId && message.status === 'received')
          if (source) {
            const delivery = document.createElement('details')
            delivery.append(element('summary', `${source.roleName ?? source.roleId}: ${source.id}`), element('pre', source.content))
            description.append(delivery)
          }
        }
      }
    }
    details.append(description)
    for (const child of project.nodes.filter(item => item.parentId === node.id)) details.append(renderNode(project, child))
    return details
  }

  function createImportForm(chat: GroupChat): HTMLFormElement {
    const text = copy()
    const result = document.createElement('form')
    result.className = 'project-import-form'
    const name = input('text', text.name)
    const goals = document.createElement('textarea')
    goals.required = true
    goals.setAttribute('aria-label', text.goals)
    const file = input('file', text.todo)
    file.accept = '.md,text/markdown,text/plain'
    const source = input('text', text.source)
    const baseCommit = input('text', 'Git base SHA (40)')
    baseCommit.pattern = '[a-f0-9]{40}'
    const manager = roleSelect(text.manager, /manager|yönetici|管理/i)
    const reviewer = roleSelect(text.reviewer, /reviewer|inceleme|复核/i)
    result.append(field(text.name, name), field(text.goals, goals), field(text.todo, file), field(text.source, source), field(text.manager, manager), field(text.reviewer, reviewer), element('h4', text.engineers))
    result.append(field('Git base SHA (40)', baseCommit))
    const assignments: Array<{ enabled: HTMLInputElement; roleId: string; branch: HTMLInputElement; worktree: HTMLInputElement; allowedPaths: HTMLInputElement }> = []
    for (const role of deps.getRoles()) {
      const enabled = input('checkbox', role.name)
      enabled.required = false
      enabled.checked = /engineer|mühendis|工程/i.test(role.name)
      const branch = input('text', `${role.name} ${text.branch}`)
      branch.required = false
      branch.value = `codex/${role.name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`
      const worktree = input('text', `${role.name} ${text.worktree}`)
      worktree.required = false
      worktree.placeholder = 'C:/Projects/isolated-worktree'
      const allowedPaths = input('text', `${role.name} allowed paths`)
      allowedPaths.required = false
      allowedPaths.placeholder = 'src/owned-module, docs/owned-file.md'
      const row = element('div', undefined, 'project-engineer-assignment')
      row.append(field(role.name, enabled), field(text.branch, branch), field(text.worktree, worktree), field('Allowed paths', allowedPaths))
      result.append(row)
      assignments.push({ enabled, roleId: role.id, branch, worktree, allowedPaths })
    }
    file.addEventListener('change', () => { if (file.files?.[0]) source.value = file.files[0].name })
    result.append(element('p', text.gate))
    const submit = button(text.save, () => undefined)
    submit.type = 'submit'
    result.append(submit)
    result.addEventListener('submit', event => {
      event.preventDefault()
      if (pending) return
      const selected = file.files?.[0]
      if (!selected) { deps.showError(text.todo); return }
      void selected.text().then(todo => act('GROUP_PROJECT_IMPORT_TODO', { project: { id: `project-${crypto.randomUUID()}`, chatId: chat.id, name: name.value, goals: goals.value, sourcePath: source.value, todo, managerRoleId: manager.value, reviewerRoleId: reviewer.value, execution: { baseCommit: baseCommit.value, allowedPaths: Object.fromEntries(assignments.filter(item => item.enabled.checked).map(item => [item.roleId, item.allowedPaths.value.split(',').map(path => path.trim()).filter(Boolean)])) }, engineers: assignments.filter(item => item.enabled.checked).map(item => ({ roleId: item.roleId, branch: item.branch.value, worktree: item.worktree.value })) } })).catch(error => deps.showError(String(error)))
    })
    return result
  }

  function roleSelect(label: string, preferred: RegExp): HTMLSelectElement {
    const select = document.createElement('select')
    select.setAttribute('aria-label', label)
    for (const role of deps.getRoles()) {
      const option = element('option', role.name) as HTMLOptionElement
      option.value = role.id
      select.append(option)
    }
    const selected = deps.getRoles().find(role => preferred.test(role.name))
    if (selected) select.value = selected.id
    return select
  }

  function registerEvents(): void {
    deps.openButton.addEventListener('click', () => { deps.modal.hidden = false; render() })
    deps.modal.addEventListener('click', event => { if (event.target === deps.modal) deps.modal.hidden = true })
    deps.modal.addEventListener('keydown', event => { if (event.key === 'Escape') deps.modal.hidden = true })
  }
  return { render, registerEvents }
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (text !== undefined) node.textContent = text
  if (className) node.className = className
  return node
}

function button(text: string, click: () => void, disabled = false): HTMLButtonElement {
  const node = element('button', text, 'btn')
  node.type = 'button'
  node.disabled = disabled
  node.addEventListener('click', click)
  return node
}

function input(type: string, label: string): HTMLInputElement {
  const node = document.createElement('input')
  node.type = type
  node.required = true
  node.setAttribute('aria-label', label)
  return node
}

function field(label: string, control: HTMLElement): HTMLLabelElement {
  const node = element('label', undefined, 'field')
  node.append(element('span', label), control)
  return node
}
