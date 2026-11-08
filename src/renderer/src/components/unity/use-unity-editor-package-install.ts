import { useEffect } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { getRuntimePathBasename } from '../../../../shared/cross-platform-path'
import { useUnityWorkspaceProjectRoots } from './unity-workbench-store'

// Main is idempotent, but one copy check per project per app session is enough.
const ensuredThisSession = new Set<string>()

/** Installs or updates Orca's Unity editor package in the active local workspace's Unity projects. */
export function useUnityEditorPackageInstall(): void {
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const enabled = useAppStore((s) => s.settings?.unityAutoInstallEditorPackage !== false)
  const roots = useUnityWorkspaceProjectRoots(activeWorktreeId)

  useEffect(() => {
    const ensure = window.api?.unity?.ensureEditorPackage
    if (!enabled || !ensure) {
      return
    }
    for (const projectRoot of roots) {
      if (ensuredThisSession.has(projectRoot)) {
        continue
      }
      ensuredThisSession.add(projectRoot)
      void ensure({ projectRoot }).then((result) => {
        const name = getRuntimePathBasename(projectRoot)
        if (!result.ok) {
          console.warn('[unity] editor package install failed', projectRoot, result.error)
        } else if (result.outcome === 'installed') {
          toast.success(
            translate(
              'auto.components.unity.UnityEditorPackageInstall.installed',
              "Orca is now Unity's script editor for {{name}}",
              { name }
            )
          )
        } else if (result.outcome === 'updated') {
          toast.success(
            translate(
              'auto.components.unity.UnityEditorPackageInstall.updated',
              "Updated Orca's Unity editor package to {{version}} for {{name}}",
              { name, version: result.version }
            )
          )
        }
      })
    }
  }, [enabled, roots])
}
