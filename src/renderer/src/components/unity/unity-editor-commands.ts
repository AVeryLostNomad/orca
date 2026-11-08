import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { errorMessage } from '../../../../shared/error-message'
import type { UnityEditorAction, UnityEditorActionResult } from '../../../../shared/unity-types'
import {
  refreshUnityEditorState,
  refreshUnityPipelineStatus,
  refreshUnityProjectInfo
} from './unity-workbench-store'

export const UNITY_CLI_DOCS_URL = 'https://docs.unity.com/en-us/unity-cli/unity-cli'

const COMPILE_ERRORS_TOAST_ID = 'unity-compile-errors'

export type UnityPanelSection = 'console' | 'tests'

const ACTION_FAILURE_TITLES: Record<UnityEditorAction, () => string> = {
  play: () =>
    translate('auto.components.unity.unity.editor.commands.playFailed', 'Couldn’t enter Play Mode'),
  pause: () =>
    translate('auto.components.unity.unity.editor.commands.pauseFailed', 'Couldn’t toggle pause'),
  stop: () =>
    translate('auto.components.unity.unity.editor.commands.stopFailed', 'Couldn’t exit Play Mode'),
  step: () =>
    translate('auto.components.unity.unity.editor.commands.stepFailed', 'Couldn’t step a frame'),
  refresh: () =>
    translate(
      'auto.components.unity.unity.editor.commands.refreshFailed',
      'Couldn’t refresh Unity assets'
    ),
  recompile: () =>
    translate(
      'auto.components.unity.unity.editor.commands.recompileFailed',
      'Couldn’t recompile scripts'
    ),
  'regenerate-project-files': () =>
    translate(
      'auto.components.unity.unity.editor.commands.regenerateFailed',
      'Couldn’t regenerate project files'
    )
}

function unavailableResult(): UnityEditorActionResult {
  return {
    ok: false,
    error: translate(
      'auto.components.unity.unity.editor.commands.unavailable',
      'Unity integration is unavailable in this window.'
    )
  }
}

function failedResult(error: unknown): UnityEditorActionResult {
  return { ok: false, error: errorMessage(error) }
}

export function revealUnityPanel(section?: UnityPanelSection): void {
  const state = useAppStore.getState()
  state.setRightSidebarOpen(true)
  state.setRightSidebarTab('unity')
  if (section) {
    window.dispatchEvent(new CustomEvent('orca:unity-panel-show', { detail: { section } }))
  }
}

/** One replaceable toast, so repeated refreshes never stack compile-error notices. */
export function reportUnityCompileErrors(result: UnityEditorActionResult): void {
  if (!result.ok || !result.compileErrors) {
    return
  }
  const count = result.compileErrors.filter((message) => message.severity === 'error').length
  if (count === 0) {
    toast.dismiss(COMPILE_ERRORS_TOAST_ID)
    return
  }
  toast.error(
    count === 1
      ? translate(
          'auto.components.unity.unity.editor.commands.compileError',
          'Unity: 1 compile error'
        )
      : translate(
          'auto.components.unity.unity.editor.commands.compileErrors',
          'Unity: {{count}} compile errors',
          { count }
        ),
    {
      id: COMPILE_ERRORS_TOAST_ID,
      action: {
        label: translate('auto.components.unity.unity.editor.commands.showConsole', 'Show console'),
        onClick: () => revealUnityPanel('console')
      }
    }
  )
}

/** Runs an editor action, surfacing failures and compile errors as toasts. */
export async function runUnityEditorAction(
  projectRoot: string,
  action: UnityEditorAction
): Promise<UnityEditorActionResult> {
  const run = window.api?.unity?.runEditorAction
  const result = run ? await run({ projectRoot, action }).catch(failedResult) : unavailableResult()
  if (!result.ok) {
    toast.error(ACTION_FAILURE_TITLES[action](), { description: result.error })
    return result
  }
  reportUnityCompileErrors(result)
  if (action === 'regenerate-project-files') {
    await refreshUnityProjectInfo(projectRoot)
    // Roslyn only discovers the solution at startup, so live C# sessions must respawn to load it.
    await window.api?.lsp?.restartServer({ serverId: 'csharp' }).catch(() => undefined)
    toast.success(
      translate(
        'auto.components.unity.unity.editor.commands.regenerated',
        'Unity project files regenerated'
      )
    )
  }
  void refreshUnityEditorState(projectRoot)
  return result
}

export async function openUnityProjectInEditor(projectRoot: string): Promise<void> {
  const open = window.api?.unity?.openProjectInEditor
  const result = open ? await open({ projectRoot }).catch(failedResult) : unavailableResult()
  if (!result.ok) {
    toast.error(
      translate('auto.components.unity.unity.editor.commands.openFailed', 'Couldn’t open Unity'),
      { description: result.error }
    )
    return
  }
  void refreshUnityEditorState(projectRoot)
}

export async function installUnityPipeline(
  projectRoot: string,
  options: { upgrade: boolean }
): Promise<void> {
  const toastId = `unity-pipeline-install:${projectRoot}`
  toast.loading(
    options.upgrade
      ? translate(
          'auto.components.unity.unity.editor.commands.upgradingPipeline',
          'Updating Unity Pipeline…'
        )
      : translate(
          'auto.components.unity.unity.editor.commands.installingPipeline',
          'Installing Unity Pipeline…'
        ),
    { id: toastId }
  )
  const install = window.api?.unity?.installPipeline
  const result = install
    ? await install({ projectRoot, upgrade: options.upgrade }).catch(failedResult)
    : unavailableResult()
  if (result.ok) {
    toast.success(
      options.upgrade
        ? translate(
            'auto.components.unity.unity.editor.commands.pipelineUpgraded',
            'Unity Pipeline updated'
          )
        : translate(
            'auto.components.unity.unity.editor.commands.pipelineInstalled',
            'Unity Pipeline installed'
          ),
      { id: toastId, description: result.message }
    )
  } else {
    toast.error(
      options.upgrade
        ? translate(
            'auto.components.unity.unity.editor.commands.pipelineUpgradeFailed',
            'Couldn’t update Unity Pipeline'
          )
        : translate(
            'auto.components.unity.unity.editor.commands.pipelineInstallFailed',
            'Couldn’t install Unity Pipeline'
          ),
      { id: toastId, description: result.error }
    )
  }
  await Promise.all([
    refreshUnityProjectInfo(projectRoot),
    refreshUnityPipelineStatus(projectRoot),
    refreshUnityEditorState(projectRoot)
  ])
}
