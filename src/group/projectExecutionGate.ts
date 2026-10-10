import type { ProjectArtifact, ProjectBacklogTask, ProjectExecutionContract, ProjectTaskNode, ProjectWorkspace } from './types'

function ancestorIds(project: ProjectWorkspace, node: ProjectTaskNode): string[] {
  const ids: string[] = []
  let parent = node.parentId
  while (parent) { ids.push(parent); parent = project.nodes.find(item => item.id === parent)?.parentId }
  return ids
}

export function isCommit(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{40}$/.test(value)
}

export function validateAllowedPaths(value: unknown): asserts value is string[] {
  if (!Array.isArray(value) || !value.length || value.some(path => typeof path !== 'string' || !path || path === '.' || path.includes('\\') || path.startsWith('/') || /[:*?]/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..') || path === '.git' || path.startsWith('.git/'))) throw new Error('Allowed paths must be explicit repository-relative files or directories without traversal/globs')
}

export function executionForNode(project: ProjectWorkspace, node: ProjectTaskNode): ProjectExecutionContract {
  if (!project.execution || !isCommit(project.execution.baseCommit)) throw new Error('Execution requires a verified full baseCommit and exclusive allowedPaths per engineer')
  const allowedPaths = project.execution.allowedPaths[node.ownerRoleId!]
  validateAllowedPaths(allowedPaths)
  const dependencyIds = [...new Set([...node.dependsOn, ...ancestorIds(project, node).flatMap(id => project.nodes.find(item => item.id === id)!.dependsOn)])]
  const dependencies: ProjectExecutionContract['dependencies'] = []
  const visit = (id: string) => {
    const children = project.nodes.filter(item => item.parentId === id)
    if (children.length) { for (const child of children) visit(child.id); return }
    const dependency = project.nodes.find(item => item.id === id)!
    if (dependency.status !== 'accepted' || !dependency.evidence?.length) throw new Error(`Dependency is not accepted: ${id}`)
    if (!dependency.artifact || !isCommit(dependency.artifact.commit)) throw new Error(`Accepted dependency has no verified commit artifact: ${id}`)
    if (!dependencies.some(item => item.taskId === id)) dependencies.push({ taskId: id, commit: dependency.artifact.commit })
  }
  for (const id of dependencyIds) visit(id)
  const scope = [node, ...ancestorIds(project, node).map(id => project.nodes.find(item => item.id === id)!)]
  const acceptanceLevel = scope.some(item => item.acceptanceLevel === 'native') ? 'native' : scope.some(item => item.acceptanceLevel === 'contract') ? 'contract' : 'source'
  return { baseCommit: project.execution.baseCommit, allowedPaths, acceptanceLevel, traceability: [...new Set(scope.flatMap(item => item.traceability ?? []))], dependencies }
}

export function validateReadiness(proof: Record<string, unknown>, task: ProjectBacklogTask): void {
  const expected = task.execution!
  const readiness = proof.readiness as Record<string, unknown> | undefined
  if (!readiness || readiness.branch !== task.branch || readiness.worktree !== task.worktree || readiness.baseCommit !== expected.baseCommit || !isCommit(readiness.headCommit) || readiness.clean !== true || readiness.baseIsAncestor !== true || JSON.stringify(readiness.allowedPaths) !== JSON.stringify(expected.allowedPaths) || !Array.isArray(readiness.dependencies) || readiness.dependencies.length !== expected.dependencies.length || expected.dependencies.some(dep => !(readiness.dependencies as unknown[]).some((value: unknown) => {
    const observed = value as Record<string, unknown> | null
    return observed?.taskId === dep.taskId && observed.commit === dep.commit && observed.isAncestor === true
  }))) throw new Error('Readiness lacks independently verified clean ownership/base/dependency commit ancestry')
}

export function validateArtifact(proof: Record<string, unknown>, task: ProjectBacklogTask): ProjectArtifact {
  const expected = task.execution!
  const artifact = proof.artifact as ProjectArtifact | undefined
  if (!artifact || !isCommit(artifact.commit) || artifact.baseCommit !== expected.baseCommit || artifact.branch !== task.branch || artifact.worktree !== task.worktree || artifact.acceptanceLevel !== expected.acceptanceLevel || !Array.isArray(artifact.changedPaths) || !artifact.changedPaths.length) throw new Error('Delivery lacks independently verified commit/base/ownership/acceptance-level artifact')
  validateAllowedPaths(artifact.changedPaths)
  if (artifact.changedPaths.some(path => !expected.allowedPaths.some(allowed => path === allowed || path.startsWith(`${allowed}/`)))) throw new Error('Delivery changes paths outside exclusive ownership')
  if (expected.acceptanceLevel === 'native' && proof.nativeVerified !== true) throw new Error('Native requirement needs real OS/device verification; synthetic evidence is insufficient')
  return artifact
}
