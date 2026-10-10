import type { ProjectNodeStatus, ProjectTaskNode, ProjectWorkspace } from './types'
import { compileProjectBacklog } from './projectBacklog'
import { isCommit, validateAllowedPaths } from './projectExecutionGate'

export function importProjectTodo(raw: unknown, now: number): ProjectWorkspace {
  const input = record(raw)
  const id = required(input.id, 'project id')
  const chatId = required(input.chatId, 'chatId')
  const managerRoleId = required(input.managerRoleId, 'Manager')
  const reviewerRoleId = required(input.reviewerRoleId, 'Reviewer')
  if (!Array.isArray(input.engineers) || !input.engineers.length || input.engineers.length > 8) throw new Error('Assign 1..8 engineers with isolated worktrees')
  const engineers = input.engineers.map(value => {
    const item = record(value)
    return { roleId: required(item.roleId, 'Engineer'), branch: required(item.branch, 'branch'), worktree: required(item.worktree, 'worktree') }
  })
  if (new Set(engineers.map(item => item.roleId)).size !== engineers.length) throw new Error('Duplicate engineer')
  compileProjectBacklog({ id, chatId, managerRoleId, reviewerRoleId, tasks: engineers.map((item, index) => ({ id: `check-${index}`, ownerRoleId: item.roleId, branch: item.branch, worktree: item.worktree, instruction: 'Validate assignment', acceptance: 'Validate assignment' })) }, now)
  const sourceText = required(input.todo, 'TODO content')
  if (sourceText.length > 500_000) throw new Error('TODO exceeds 500 KB')
  const nodes = parseProjectTodo(sourceText, now)
  let productProgress: ProjectWorkspace['productProgress']
  if (input.productProgress !== undefined) {
    const snapshot = record(input.productProgress)
    if (typeof snapshot.percent !== 'number' || !Number.isFinite(snapshot.percent) || snapshot.percent < 0 || snapshot.percent > 100) throw new Error('Product progress must be an explicit 0..100 ledger snapshot')
    productProgress = { percent: snapshot.percent, sourcePath: required(snapshot.sourcePath, 'product progress ledger'), asOf: required(snapshot.asOf, 'product progress observation date'), evidence: required(snapshot.evidence, 'product acceptance evidence') }
  }
  let execution: ProjectWorkspace['execution']
  if (input.execution !== undefined) {
    const contract = record(input.execution)
    if (!isCommit(contract.baseCommit)) throw new Error('baseCommit must be a full lowercase Git SHA')
    const paths = record(contract.allowedPaths)
    const allowedPaths: Record<string, string[]> = {}
    for (const engineer of engineers) { validateAllowedPaths(paths[engineer.roleId]); allowedPaths[engineer.roleId] = paths[engineer.roleId] as string[] }
    const entries = Object.entries(allowedPaths)
    for (const [index, [, own]] of entries.entries()) for (const [, other] of entries.slice(index + 1)) {
      if (own.some(a => other.some(b => a.toLowerCase() === b.toLowerCase() || a.toLowerCase().startsWith(`${b.toLowerCase()}/`) || b.toLowerCase().startsWith(`${a.toLowerCase()}/`)))) throw new Error('Engineers must have exclusive nonoverlapping allowedPaths')
    }
    execution = { baseCommit: contract.baseCommit, allowedPaths }
  }
  return { id, chatId, name: required(input.name, 'project name'), goals: required(input.goals, 'project goals'), sourcePath: required(input.sourcePath, 'TODO source'), sourceText, managerRoleId, reviewerRoleId, engineers, execution, productProgress, nodes, status: 'draft', createdAt: now, updatedAt: now }
}

export function parseProjectTodo(text: string, now: number): ProjectTaskNode[] {
  const nodes: ProjectTaskNode[] = []
  const headings: Array<{ depth: number; id: string }> = []
  const items: Array<{ indent: number; id: string }> = []
  let fenced = false
  for (const [index, line] of text.replace(/\r/g, '').split('\n').entries()) {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue }
    if (fenced) continue
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*$/)
    const checkbox = line.match(/^(\s*)[-*+]\s+\[([ xX])\]\s+(.+)$/)
    if (!heading && !checkbox) continue
    const metadata = (heading?.[2] ?? checkbox?.[3])?.match(/\s*<!--\s*openteam:\s*(\{.*\})\s*-->\s*$/)
    let attrs: Record<string, unknown> = {}
    if (metadata) {
      try { attrs = record(JSON.parse(metadata[1])) } catch { throw new Error(`Invalid task metadata at line ${index + 1}`) }
    }
    const id = attrs.id === undefined ? `todo-${index + 1}` : required(attrs.id, 'task id')
    if (nodes.some(node => node.id === id)) throw new Error(`Duplicate task id: ${id}`)
    let parentId: string | undefined
    if (heading) {
      while (headings.length && headings[headings.length - 1].depth >= heading[1].length) headings.pop()
      parentId = headings[headings.length - 1]?.id
      headings.push({ depth: heading[1].length, id })
      items.length = 0
    } else if (checkbox) {
      const indent = checkbox[1].replace(/\t/g, '  ').length
      while (items.length && items[items.length - 1].indent >= indent) items.pop()
      parentId = items[items.length - 1]?.id ?? headings[headings.length - 1]?.id
      items.push({ indent, id })
    }
    const title = (heading?.[2] ?? checkbox![3]).replace(metadata?.[0] ?? /$^/, '').trim()
    const weight = attrs.weight === undefined ? 1 : Number(attrs.weight)
    if (!Number.isFinite(weight) || weight <= 0 || weight > 1000) throw new Error(`Invalid task weight at line ${index + 1}`)
    const dependsOn = attrs.dependsOn ?? []
    if (!Array.isArray(dependsOn) || dependsOn.some(dep => typeof dep !== 'string')) throw new Error(`Invalid dependencies at line ${index + 1}`)
    const requiresApproval = attrs.requiresApproval === true
    if (attrs.acceptanceLevel !== undefined && !['source', 'contract', 'native'].includes(String(attrs.acceptanceLevel))) throw new Error(`Invalid acceptanceLevel at line ${index + 1}`)
    if (attrs.traceability !== undefined && (!Array.isArray(attrs.traceability) || attrs.traceability.some(value => typeof value !== 'string' || !value.trim()))) throw new Error(`Invalid traceability at line ${index + 1}`)
    nodes.push({ id, parentId, title, instruction: title, acceptance: typeof attrs.acceptance === 'string' && attrs.acceptance.trim() ? attrs.acceptance.trim() : `Verify the full requirement: ${title}. Read actual sources, run relevant acceptance tests and verify Git/worktree ownership.`, acceptanceLevel: attrs.acceptanceLevel === 'native' ? 'native' : attrs.acceptanceLevel === 'contract' ? 'contract' : 'source', traceability: Array.isArray(attrs.traceability) ? attrs.traceability.filter((value): value is string => typeof value === 'string') : [], kind: heading ? 'group' : 'task', weight, dependsOn: dependsOn as string[], sourceLine: index + 1, sourceChecked: checkbox ? checkbox[2].toLowerCase() === 'x' : undefined, requiresApproval, planned: attrs.executable === true, status: requiresApproval ? 'approval' : 'open', events: [{ at: now, status: requiresApproval ? 'approval' : 'open', reason: checkbox?.[2].toLowerCase() === 'x' ? 'Imported checkbox is historical; independent acceptance still required' : 'Imported from TODO' }] })
  }
  const retained = nodes.filter(node => node.kind !== 'group' || nodes.some(other => other.parentId === node.id && (other.kind !== 'group' || hasTaskDescendant(nodes, other.id))))
  if (!retained.length || retained.length > 300) throw new Error('TODO must contain tasks; maximum 300 hierarchy nodes')
  validateDependencies(retained)
  return retained
}

function hasTaskDescendant(nodes: ProjectTaskNode[], id: string): boolean {
  return nodes.some(node => node.parentId === id && (node.kind !== 'group' || hasTaskDescendant(nodes, node.id)))
}

export function validateDependencies(nodes: ProjectTaskNode[]): void {
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error(`Cyclic project dependency: ${id}`)
    if (visited.has(id)) return
    const node = nodes.find(item => item.id === id)
    if (!node) throw new Error(`Missing dependency: ${id}`)
    visiting.add(id)
    for (const dep of [...node.dependsOn, ...nodes.filter(item => item.parentId === id).map(item => item.id)]) visit(dep)
    visiting.delete(id)
    visited.add(id)
  }
  for (const node of nodes) visit(node.id)
}

export function projectNodeProgress(project: ProjectWorkspace, id: string): { fraction: number; status: ProjectNodeStatus } {
  const node = project.nodes.find(item => item.id === id)!
  const children = project.nodes.filter(item => item.parentId === id)
  if (!children.length) return { fraction: node.status === 'accepted' && Boolean(node.evidence?.length) ? 1 : 0, status: node.status === 'accepted' && !node.evidence?.length ? 'open' : node.status }
  const states = children.map(child => ({ ...projectNodeProgress(project, child.id), weight: child.weight }))
  const fraction = states.reduce((sum, state) => sum + state.fraction * state.weight, 0) / states.reduce((sum, state) => sum + state.weight, 0)
  const status: ProjectNodeStatus = fraction === 1 ? 'accepted' : states.some(state => state.status === 'blocked') ? 'blocked' : states.some(state => state.status === 'rework') ? 'rework' : states.some(state => state.status === 'review') ? 'review' : states.some(state => state.status === 'running' || state.status === 'planning' || state.status === 'queued') ? 'running' : states.some(state => state.status === 'approval') ? 'approval' : 'open'
  return { fraction, status }
}

export function projectSummary(project: ProjectWorkspace) {
  const roots = project.nodes.filter(node => !node.parentId)
  const denominator = roots.reduce((sum, node) => sum + node.weight, 0)
  const fraction = denominator ? roots.reduce((sum, node) => sum + node.weight * projectNodeProgress(project, node.id).fraction, 0) / denominator : 0
  const leaves = project.nodes.filter(node => !project.nodes.some(other => other.parentId === node.id))
  return { progressPercent: Math.floor(fraction * 1000) / 10, accepted: leaves.filter(node => projectNodeProgress(project, node.id).status === 'accepted').length, total: leaves.length, open: leaves.filter(node => projectNodeProgress(project, node.id).status !== 'accepted').length, nodes: project.nodes.map(node => ({ ...node, ...projectNodeProgress(project, node.id) })) }
}

export function nextProjectTask(project: ProjectWorkspace): ProjectTaskNode | undefined {
  return project.nodes.find(node => node.status === 'open' && !node.requiresApproval && !project.nodes.some(other => other.parentId === node.id) &&
    ancestorIds(project, node).every(id => { const ancestor = project.nodes.find(item => item.id === id)!; return !ancestor.requiresApproval && ancestor.dependsOn.every(dep => projectNodeProgress(project, dep).fraction === 1) }) &&
    node.dependsOn.every(dep => projectNodeProgress(project, dep).fraction === 1))
}

export function ancestorIds(project: ProjectWorkspace, node: ProjectTaskNode): string[] {
  const result: string[] = []
  let parent = node.parentId
  while (parent) { result.unshift(parent); parent = project.nodes.find(item => item.id === parent)?.parentId }
  return result
}

export function applyManagerBreakdown(project: ProjectWorkspace, parent: ProjectTaskNode, content: string, now: number): void {
  const raw = record(JSON.parse(content.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')))
  if (!Array.isArray(raw.phases) || raw.phases.length < 1 || raw.phases.length > 8) throw new Error('Manager must return 1..8 concrete phases')
  if (project.nodes.length + raw.phases.length > 300) throw new Error('Project decomposition budget exceeded')
  const rawPhases = raw.phases
  const phases = rawPhases.map((value, index) => {
    const phase = record(value)
    const id = `${parent.id}/phase-${index + 1}`
    const requiresApproval = parent.requiresApproval || phase.requiresApproval === true
    const dependsOn = index ? [`${parent.id}/phase-${index}`] : []
    return { id, parentId: parent.id, title: required(phase.title, 'phase title'), instruction: `${parent.instruction}\n\nCurrent phase: ${required(phase.instruction, 'phase instruction')}`, acceptance: `${required(phase.acceptance, 'phase acceptance')}${index === rawPhases.length - 1 ? `\nIntegrated original requirement: ${parent.acceptance}` : '\nAccept only this phase; the parent task remains open until integrated acceptance.'}`, acceptanceLevel: parent.acceptanceLevel, traceability: parent.traceability, kind: 'phase' as const, weight: 1, dependsOn, ownerRoleId: parent.ownerRoleId, requiresApproval, planned: true, status: requiresApproval ? 'approval' as const : 'open' as const, events: [{ at: now, status: 'open' as const, reason: 'Manager breakdown; no completion claimed' }] }
  })
  if (phases.some(phase => project.nodes.some(node => node.id === phase.id))) throw new Error('Manager breakdown already applied')
  project.nodes.splice(project.nodes.indexOf(parent) + 1, 0, ...phases)
  parent.planned = true
  parent.status = 'open'
  delete parent.runKey
  delete parent.runId
  validateDependencies(project.nodes)
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected project/task object')
  return value as Record<string, unknown>
}

function required(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing ${name}`)
  return value.trim()
}
