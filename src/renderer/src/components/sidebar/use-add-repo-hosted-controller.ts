import type { CompleteGitRepoAdd } from './use-complete-git-repo-add'
import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { markOnboardingProjectAdded } from '@/lib/onboarding-project-checklist'

/** Nest Add Project in a host surface rather than replacing the store modal. */
export type AddRepoDialogHostedController = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Select the added Git project instead of navigating to its default checkout. */
  onProjectAdded: (repoId: string) => void | Promise<void>
  onProjectGroupImported?: (groupId: string) => boolean | Promise<boolean>
  /** Let the host redirect focus because the opening combobox row may already be unmounted. */
  onCloseAutoFocus?: (event: Event) => void
}

export function useAddRepoHostedController(hosted: AddRepoDialogHostedController | undefined): {
  closeModal: () => void
  /** Close both dialog layers before activating a workspace or opening a
   *  navigation modal. Hosted mode must not obscure the destination. */
  closeForNavigationHandoff: () => void
  finishProjectAdd: CompleteGitRepoAdd | undefined
} {
  const storeCloseModal = useAppStore((s) => s.closeModal)
  const hostedOnOpenChange = hosted?.onOpenChange
  const hostedOnProjectAdded = hosted?.onProjectAdded
  const hostedOnProjectGroupImported = hosted?.onProjectGroupImported
  // Closing nested Add Project must leave its parent composer modal open.
  const closeModal = useMemo(
    () => (hostedOnOpenChange ? () => hostedOnOpenChange(false) : storeCloseModal),
    [hostedOnOpenChange, storeCloseModal]
  )
  const finishProjectAdd = useMemo<CompleteGitRepoAdd | undefined>(
    () =>
      hostedOnOpenChange && hostedOnProjectAdded
        ? async (repoId, _source, _executionHostId, outcome): Promise<void> => {
            await markOnboardingProjectAdded('addedRepo')
            hostedOnOpenChange(false)
            if (
              outcome?.importedProjectGroupId &&
              (await hostedOnProjectGroupImported?.(outcome.importedProjectGroupId))
            ) {
              return
            }
            await hostedOnProjectAdded(repoId)
          }
        : undefined,
    [hostedOnOpenChange, hostedOnProjectAdded, hostedOnProjectGroupImported]
  )
  const closeForNavigationHandoff = useMemo(
    () =>
      hostedOnOpenChange
        ? () => {
            hostedOnOpenChange(false)
            storeCloseModal()
          }
        : storeCloseModal,
    [hostedOnOpenChange, storeCloseModal]
  )
  return { closeModal, closeForNavigationHandoff, finishProjectAdd }
}
