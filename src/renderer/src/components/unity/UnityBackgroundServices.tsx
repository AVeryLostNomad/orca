import { useUnityAutoRefresh } from './use-unity-auto-refresh'
import { useUnityEditorPackageInstall } from './use-unity-editor-package-install'
import { useUnityPipelinePrompt } from './UnityPipelinePrompt'

/** App-root Unity listeners with no surface of their own. */
export function UnityBackgroundServices(): null {
  useUnityAutoRefresh()
  useUnityPipelinePrompt()
  useUnityEditorPackageInstall()
  return null
}
