import { getRepoExecutionHostId, LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'
import type { ProjectGroup } from '../../shared/project-group-types'
import { resolveProjectAccountPin } from '../../shared/project-account-pins'
import type { Repo } from '../../shared/repo-types'
import { findRepoForCwd } from './repo-for-cwd'

export type ProjectAgentAccountPinStore = {
  getRepos: () => Repo[]
  getProjectGroups: () => ProjectGroup[]
}

/**
 * The managed agent account a local launch in `cwd` should run as, from the
 * owning project's own pin or the nearest group pin. Null = global selection.
 */
export function resolveProjectAgentAccountIdForCwd(
  store: ProjectAgentAccountPinStore | null | undefined,
  cwd: string | undefined,
  field: 'claudeAccountId' | 'codexAccountId'
): string | null {
  if (!store || !cwd) {
    return null
  }
  // Why: managed accounts live on this machine; SSH/runtime projects use their host's own login.
  const localRepos = store
    .getRepos()
    .filter((repo) => getRepoExecutionHostId(repo) === LOCAL_EXECUTION_HOST_ID)
  const repo = findRepoForCwd(localRepos, cwd)
  return repo ? resolveProjectAccountPin(repo, store.getProjectGroups(), field).value : null
}
