import { translate } from '@/i18n/i18n'
import type { UnityProjectInfo } from '../../../../shared/unity-types'
import type { UnityStringSlot, UnityStringSlotKind } from './unity-string-literal-context'

/** Project-relative scene path from `Assets/` with forward slashes. */
function normalizeScenePath(path: string): string {
  const forward = path.replace(/\\/g, '/')
  const assets = forward.indexOf('Assets/')
  return assets === -1 ? forward : forward.slice(assets)
}

/** Build-settings scene a LoadScene string refers to: name, full path, or path suffix. */
function findBuildScene(
  project: UnityProjectInfo,
  value: string
): UnityProjectInfo['scenes'][number] | null {
  const wanted = value.replace(/\\/g, '/').replace(/\.unity$/i, '')
  for (const scene of project.scenes) {
    if (scene.name === wanted) {
      return scene
    }
    const path = normalizeScenePath(scene.path).replace(/\.unity$/i, '')
    if (path === wanted || path.endsWith(`/${wanted}`)) {
      return scene
    }
  }
  return null
}

export function unityStringSlotCandidates(
  project: UnityProjectInfo,
  kind: UnityStringSlotKind
): { label: string; detail: string }[] {
  switch (kind) {
    case 'tag':
      return project.tags.map((tag) => ({
        label: tag,
        detail: translate('auto.lib.unity.strings.tagDetail', 'Tag')
      }))
    case 'layer':
      return project.layers.map((layer) => ({
        label: layer.name,
        detail: translate('auto.lib.unity.strings.layerDetail', 'Layer {{index}}', {
          index: layer.index
        })
      }))
    case 'sortingLayer':
      return sortingLayersOf(project).map((name) => ({
        label: name,
        detail: translate('auto.lib.unity.strings.sortingLayerDetail', 'Sorting layer')
      }))
    case 'input':
      return project.inputAxes.map((axis) => ({
        label: axis,
        detail: translate('auto.lib.unity.strings.inputAxisDetail', 'Input axis')
      }))
    case 'scene': {
      const enabledScenes = project.scenes.filter((scene) => scene.enabled)
      return project.scenes.flatMap((scene) => {
        const status = scene.enabled
          ? translate('auto.lib.unity.strings.sceneBuildIndex', 'build index {{index}}', {
              index: enabledScenes.indexOf(scene)
            })
          : translate('auto.lib.unity.strings.sceneDisabled', 'disabled in build')
        return [
          {
            label: scene.name,
            detail: translate('auto.lib.unity.strings.sceneDetail', 'Scene · {{status}}', {
              status
            })
          },
          {
            label: normalizeScenePath(scene.path).replace(/\.unity$/i, ''),
            detail: translate('auto.lib.unity.strings.scenePathDetail', 'Scene path · {{status}}', {
              status
            })
          }
        ]
      })
    }
  }
}

function sortingLayersOf(project: UnityProjectInfo): string[] {
  return project.sortingLayers.includes('Default')
    ? project.sortingLayers
    : ['Default', ...project.sortingLayers]
}

export type UnityStringSlotProblem = {
  slot: UnityStringSlot
  severity: 'warning' | 'info'
  text: string
}

export function validateUnityStringSlot(
  project: UnityProjectInfo,
  slot: UnityStringSlot
): UnityStringSlotProblem | null {
  if (slot.sceneIndex !== undefined) {
    const enabled = project.scenes.filter((s) => s.enabled).length
    return slot.sceneIndex >= enabled
      ? {
          slot,
          severity: 'warning',
          text: translate(
            'auto.lib.unity.strings.sceneIndexOutOfRange',
            'Build index {{index}} is out of range: {{count}} scene(s) are enabled in the build settings.',
            {
              index: slot.sceneIndex,
              count: enabled
            }
          )
        }
      : null
  }
  if (slot.value === null) {
    return null
  }
  const value = slot.value
  switch (slot.kind) {
    case 'tag':
      return project.tags.includes(value)
        ? null
        : {
            slot,
            severity: 'warning',
            text: translate(
              'auto.lib.unity.strings.unknownTag',
              "The tag '{{value}}' is not defined in the Tags & Layers settings.",
              { value }
            )
          }
    case 'layer':
      return project.layers.some((layer) => layer.name === value)
        ? null
        : {
            slot,
            severity: 'warning',
            text: translate(
              'auto.lib.unity.strings.unknownLayer',
              "The layer '{{value}}' is not defined in the Tags & Layers settings.",
              { value }
            )
          }
    case 'sortingLayer':
      return sortingLayersOf(project).includes(value)
        ? null
        : {
            slot,
            severity: 'warning',
            text: translate(
              'auto.lib.unity.strings.unknownSortingLayer',
              "The sorting layer '{{value}}' is not defined in the Tags & Layers settings.",
              { value }
            )
          }
    case 'input':
      return project.inputAxes.includes(value)
        ? null
        : {
            slot,
            severity: 'warning',
            text: translate(
              'auto.lib.unity.strings.unknownInputAxis',
              "The input axis '{{value}}' is not defined in the Input Manager.",
              { value }
            )
          }
    case 'scene': {
      const scene = findBuildScene(project, value)
      if (!scene) {
        return {
          slot,
          severity: 'warning',
          text: translate(
            'auto.lib.unity.strings.unknownScene',
            "The scene '{{value}}' is not in the build settings.",
            { value }
          )
        }
      }
      return scene.enabled
        ? null
        : {
            slot,
            severity: 'info',
            text: translate(
              'auto.lib.unity.strings.disabledScene',
              "The scene '{{value}}' is disabled in the build settings.",
              { value }
            )
          }
    }
  }
}
