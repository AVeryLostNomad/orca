import { useEffect } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { Button } from '@/components/ui/button'
import { getRuntimePathBasename } from '../../../../shared/cross-platform-path'
import { useActiveUnityProject } from './unity-workbench-store'
import { installUnityPipeline } from './unity-editor-commands'

// "Not now" lasts for this window session only.
const suppressedThisSession = new Set<string>()
// Programmatic dismissals must not count as the user closing the prompt.
const quietDismissals = new Set<string>()

function promptToastId(projectRoot: string): string {
  return `unity-pipeline-prompt:${projectRoot}`
}

function dismissQuietly(projectRoot: string): void {
  quietDismissals.add(projectRoot)
  toast.dismiss(promptToastId(projectRoot))
}

function PipelinePromptBody({ projectRoot }: { projectRoot: string }): React.JSX.Element {
  const install = (): void => {
    dismissQuietly(projectRoot)
    void installUnityPipeline(projectRoot, { upgrade: false })
  }
  const notNow = (): void => {
    suppressedThisSession.add(projectRoot)
    dismissQuietly(projectRoot)
  }
  const dontAskAgain = (): void => {
    suppressedThisSession.add(projectRoot)
    dismissQuietly(projectRoot)
    const state = useAppStore.getState()
    const dismissed = state.settings?.unityPipelinePromptDismissed ?? []
    if (!dismissed.includes(projectRoot)) {
      void Promise.resolve(
        state.updateSettings({ unityPipelinePromptDismissed: [...dismissed, projectRoot] })
      ).catch(() => {})
    }
  }

  return (
    <div className="flex w-full flex-col gap-3">
      <p className="text-sm leading-5 text-popover-foreground/80">
        {translate(
          'auto.components.unity.UnityPipelinePrompt.description',
          'Installs the Unity Pipeline package ({{command}}).',
          { command: 'unity pipeline install' }
        )}
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={dontAskAgain}>
          {translate('auto.components.unity.UnityPipelinePrompt.dontAskAgain', 'Don’t ask again')}
        </Button>
        <Button size="sm" variant="ghost" onClick={notNow}>
          {translate('auto.components.unity.UnityPipelinePrompt.notNow', 'Not now')}
        </Button>
        <Button size="sm" onClick={install}>
          {translate('auto.components.unity.UnityPipelinePrompt.install', 'Install')}
        </Button>
      </div>
    </div>
  )
}

/** Offers `unity pipeline install` once per session for the active Unity project lacking the package. */
export function useUnityPipelinePrompt(): void {
  const project = useActiveUnityProject()
  const dismissed = useAppStore((s) => s.settings?.unityPipelinePromptDismissed)
  const projectRoot = project?.projectRoot ?? null
  const eligible =
    project !== null &&
    project.cliStatus?.available === true &&
    project.info?.pipelinePackage.installed === false &&
    !(dismissed ?? []).includes(project.projectRoot)

  useEffect(() => {
    if (!projectRoot || !eligible || suppressedThisSession.has(projectRoot)) {
      return
    }
    quietDismissals.delete(projectRoot)
    // A custom body keeps three actions; Sonner's native row fits only action + cancel.
    toast.info(
      translate(
        'auto.components.unity.UnityPipelinePrompt.title',
        'Enable Unity editor integration for {{name}}?',
        { name: getRuntimePathBasename(projectRoot) }
      ),
      {
        id: promptToastId(projectRoot),
        description: <PipelinePromptBody projectRoot={projectRoot} />,
        duration: Infinity,
        dismissible: true,
        // Close/swipe means "Not now"; body actions dismiss quietly.
        onDismiss: () => {
          if (!quietDismissals.delete(projectRoot)) {
            suppressedThisSession.add(projectRoot)
          }
        }
      }
    )
    return () => dismissQuietly(projectRoot)
  }, [projectRoot, eligible])
}
