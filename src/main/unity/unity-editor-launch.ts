import type { UnityEditorActionResult } from '../../shared/unity-types'
import { launchUnityCli } from './unity-cli'
import { NOT_A_PROJECT_ERROR, isLocalUnityProject } from './unity-editor-bridge'

export async function openUnityProjectInEditor(
  projectRoot: string
): Promise<UnityEditorActionResult> {
  if (!(await isLocalUnityProject(projectRoot))) {
    return { ok: false, error: NOT_A_PROJECT_ERROR }
  }
  try {
    const launch = await launchUnityCli(['open', projectRoot], { settleMs: 30_000 })
    if (launch.exited && launch.code !== 0) {
      return {
        ok: false,
        error: launch.output.trim() || `unity open exited with code ${launch.code}.`
      }
    }
    return { ok: true, message: 'Opening the project in Unity…' }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function openUnityDocs(
  projectRoot: string,
  topic: string
): Promise<UnityEditorActionResult> {
  if (!(await isLocalUnityProject(projectRoot))) {
    return { ok: false, error: NOT_A_PROJECT_ERROR }
  }
  if (typeof topic !== 'string' || topic.trim().length === 0) {
    return { ok: false, error: 'No documentation topic given.' }
  }
  try {
    // cwd selects the project so the docs match its editor version.
    const launch = await launchUnityCli(['docs', topic.trim()], {
      settleMs: 20_000,
      cwd: projectRoot
    })
    if (launch.exited && launch.code !== 0) {
      return {
        ok: false,
        error: launch.output.trim() || `unity docs exited with code ${launch.code}.`
      }
    }
    return { ok: true, message: `Opened Unity docs for ${topic.trim()}.` }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
