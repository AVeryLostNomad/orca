import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { extractIpcErrorMessage } from '@/lib/ipc-error'
import { getRepoExecutionHostId, LOCAL_EXECUTION_HOST_ID } from '../../../../shared/execution-host'
import type { Repo } from '../../../../shared/repo-types'
import type { PrototypeGithubVisibility } from '../../../../shared/prototype-types'
import { upsertAddedRepoWithProjectHostSetup } from './add-repo-store-upsert'
import { openProjectDefaultCheckout } from './project-added-default-checkout'

function findLocalPrototype(repoId: string): Repo | null {
  return (
    useAppStore
      .getState()
      .repos.find(
        (repo) =>
          repo.id === repoId &&
          repo.isPrototype === true &&
          getRepoExecutionHostId(repo) === LOCAL_EXECUTION_HOST_ID
      ) ?? null
  )
}

function isLocalRepoRegistered(repoId: string): boolean {
  return useAppStore
    .getState()
    .repos.some(
      (repo) => repo.id === repoId && getRepoExecutionHostId(repo) === LOCAL_EXECUTION_HOST_ID
    )
}

async function addAndOpenLocalRepo(repo: Repo): Promise<void> {
  const added = upsertAddedRepoWithProjectHostSetup(repo).repo
  const state = useAppStore.getState()
  await state.fetchWorktrees(added.id)
  await openProjectDefaultCheckout({
    repoId: added.id,
    source: 'create_project',
    setHideDefaultBranchWorkspace: state.setHideDefaultBranchWorkspace
  })
}

export async function createPrototypeAndOpen(): Promise<void> {
  const toastId = toast.loading(
    translate('auto.components.sidebar.prototypes.creating', 'Creating prototype…')
  )
  const failureTitle = translate(
    'auto.components.sidebar.prototypes.createFailed',
    'Could not create prototype'
  )
  try {
    const result = await window.api.prototypes.create()
    if ('error' in result) {
      toast.error(failureTitle, { id: toastId, description: result.error })
      return
    }
    toast.success(translate('auto.components.sidebar.prototypes.created', 'Prototype created'), {
      id: toastId,
      description: result.repo.path
    })
    await addAndOpenLocalRepo(result.repo)
  } catch (error) {
    toast.error(failureTitle, {
      id: toastId,
      description: extractIpcErrorMessage(error, String(error))
    })
  }
}

export async function removePrototype(repoId: string): Promise<void> {
  const prototype = findLocalPrototype(repoId)
  if (!prototype) {
    return
  }
  // Why: removeProject stops the prototype's terminals first, so the delete below isn't racing live shells.
  await useAppStore.getState().removeProject(repoId, {
    hostId: LOCAL_EXECUTION_HOST_ID,
    errorFeedback: 'toast'
  })
  if (isLocalRepoRegistered(repoId)) {
    return
  }
  try {
    const result = await window.api.prototypes.deleteFiles({
      path: prototype.path
    })
    if ('error' in result) {
      toast.error(
        translate(
          'auto.components.sidebar.prototypes.deleteFilesFailed',
          'Prototype removed, but its files were not deleted'
        ),
        { description: `${result.error} (${prototype.path})` }
      )
      return
    }
    for (const warning of result.warnings) {
      toast.warning(warning)
    }
    toast.success(translate('auto.components.sidebar.prototypes.deleted', 'Prototype deleted'), {
      description: prototype.displayName
    })
  } catch (error) {
    toast.error(
      translate(
        'auto.components.sidebar.prototypes.deleteFilesFailed',
        'Prototype removed, but its files were not deleted'
      ),
      { description: extractIpcErrorMessage(error, String(error)) }
    )
  }
}

export async function promotePrototypeToProject(args: {
  repoId: string
  parentPath: string
  name: string
  publishToGithub: boolean
  githubVisibility: PrototypeGithubVisibility
  githubAccountRef: string | null
}): Promise<{ error: string } | { ok: true }> {
  const prototype = findLocalPrototype(args.repoId)
  if (!prototype) {
    return { error: 'Prototype not found' }
  }
  const target = { parentPath: args.parentPath.trim(), name: args.name.trim() }
  const preflight = await window.api.prototypes.preflightPromote({
    repoId: prototype.id,
    ...target
  })
  if ('error' in preflight) {
    return preflight
  }
  // Why: the move needs the prototype's terminals gone (Windows can't rename a dir a shell sits in).
  await useAppStore.getState().removeProject(prototype.id, { hostId: LOCAL_EXECUTION_HOST_ID })
  if (isLocalRepoRegistered(prototype.id)) {
    return { error: 'Could not close the prototype before moving it' }
  }
  const result = await window.api.prototypes.promote({
    ...target,
    sourcePath: preflight.sourcePath,
    prototypeDisplayName: prototype.displayName,
    publishToGithub: args.publishToGithub,
    githubVisibility: args.githubVisibility,
    ...(args.githubAccountRef ? { githubAccountRef: args.githubAccountRef } : {})
  })
  if ('error' in result) {
    if (result.restoredPrototype) {
      await addAndOpenLocalRepo(result.restoredPrototype)
    }
    return { error: result.error }
  }
  toast.success(translate('auto.components.sidebar.prototypes.promoted', 'Promoted to project'), {
    description: result.githubUrl ?? result.repo.path
  })
  for (const warning of result.warnings) {
    toast.warning(warning)
  }
  await addAndOpenLocalRepo(result.repo)
  return { ok: true }
}
