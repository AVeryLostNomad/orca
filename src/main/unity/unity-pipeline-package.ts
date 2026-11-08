import type { UnityEditorActionResult, UnityPipelineStatus } from '../../shared/unity-types'
import { runUnityCliJson } from './unity-cli'
import { NOT_A_PROJECT_ERROR, isLocalUnityProject, unityProjectKey } from './unity-editor-bridge'
import { payloadField, payloadString } from './unity-payload-fields'
import { getUnityProjectInfoForRoot, invalidateUnityProjectInfo } from './unity-project-info'

/** Live editor facts from `unity pipeline editors` when the project is open, else Packages/manifest.json. */
export async function getUnityPipelineStatus(projectRoot: string): Promise<UnityPipelineStatus> {
  const fromManifest = (await isLocalUnityProject(projectRoot))
    ? (await getUnityProjectInfoForRoot(projectRoot)).pipelinePackage
    : { installed: false, version: null }
  const listing = await runUnityCliJson(['pipeline', 'editors'], { timeoutMs: 20_000 })
  const latest = listing.ok ? payloadField(listing.data, 'latestVersion') : null
  const latestVersion = typeof latest === 'string' ? latest : null
  const instances = listing.ok ? payloadField(listing.data, 'instances') : null
  const instance = Array.isArray(instances)
    ? instances.find((candidate) => {
        const path = payloadField(candidate, 'projectPath')
        return typeof path === 'string' && unityProjectKey(path) === unityProjectKey(projectRoot)
      })
    : undefined
  if (instance && typeof payloadField(instance, 'hasPipelinePackage') === 'boolean') {
    const version = payloadField(instance, 'pipelineVersion')
    return {
      installed: payloadField(instance, 'hasPipelinePackage') === true,
      version: typeof version === 'string' ? version : fromManifest.version,
      latestVersion,
      updateAvailable: payloadField(instance, 'updateAvailable') === true
    }
  }
  // Manifest specs may be git URLs or file: paths; only plain registry versions compare to latest.
  const registryVersion =
    fromManifest.version && /^\d+\.\d+\.\d+/.test(fromManifest.version)
      ? fromManifest.version
      : null
  return {
    installed: fromManifest.installed,
    version: fromManifest.version,
    latestVersion,
    updateAvailable: Boolean(registryVersion && latestVersion && registryVersion !== latestVersion)
  }
}

export async function installUnityPipeline(
  projectRoot: string,
  upgrade: boolean
): Promise<UnityEditorActionResult> {
  if (!(await isLocalUnityProject(projectRoot))) {
    return { ok: false, error: NOT_A_PROJECT_ERROR }
  }
  const result = await runUnityCliJson(
    [
      'pipeline',
      upgrade ? 'upgrade' : 'install',
      '--project-path',
      projectRoot,
      '--non-interactive'
    ],
    { timeoutMs: 300_000 }
  )
  invalidateUnityProjectInfo(projectRoot)
  if (!result.ok) {
    return result
  }
  const version = payloadString(result.data, 'version')
  const label = version ? `Unity Pipeline ${version}` : 'Unity Pipeline'
  return {
    ok: true,
    message:
      payloadField(result.data, 'alreadyInstalled') === true
        ? `${label} is already installed.`
        : `${label} ${upgrade ? 'upgraded' : 'installed'}. Unity resolves it when the editor next refreshes.`
  }
}
