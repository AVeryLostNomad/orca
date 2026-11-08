import { translate } from '@/i18n/i18n'
import type * as Monaco from 'monaco-editor'
import type { UnityAssetUsage } from '../../../../shared/unity-types'
import { SHOW_UNITY_ASSET_USAGES_COMMAND } from './unity-asset-usage-peek'
import { OPEN_UNITY_DOCS_COMMAND } from './unity-docs'
import type { UnityInsightLens } from './unity-insight-analysis'
import {
  onUnityInsightChanged,
  unityInsightForModel,
  type UnityModelInsight
} from './unity-insight-model-state'

type MonacoModule = typeof Monaco

const USAGE_CACHE_TTL_MS = 30_000

// Monaco codicon syntax, not user text.
const LENS_ICONS = {
  event: '$(symbol-event)',
  field: '$(symbol-field)',
  file: '$(symbol-file)'
} as const

type UnityCodeLens = Monaco.languages.CodeLens & {
  unity?: { lens: UnityInsightLens; modelUri: string }
}

const usageCache = new Map<string, { at: number; usages: Promise<UnityAssetUsage[]> }>()

function cachedUsages(
  key: string,
  load: () => Promise<UnityAssetUsage[]>
): Promise<UnityAssetUsage[]> {
  const cached = usageCache.get(key)
  if (cached && Date.now() - cached.at < USAGE_CACHE_TTL_MS) {
    return cached.usages
  }
  const usages = load().catch(() => [])
  usageCache.set(key, { at: Date.now(), usages })
  return usages
}

// Last resolved handler-usage count per method. Monaco keeps a lens row (and a dangling " | " after
// neighbouring lenses) for any provided lens, even one resolved without a command, so methods known
// to have no handler usages are left out of provideCodeLenses instead.
const handlerUsageCounts = new Map<string, number>()

function handlerUsageKey(filePath: string, methodName: string): string {
  return `method|${filePath}|${methodName}`
}

/** Keeps known-unbound methods lens-free while revalidating so a newly bound handler reappears. */
function wantsHandlerLens(filePath: string, methodName: string, refresh: () => void): boolean {
  const key = handlerUsageKey(filePath, methodName)
  const unity = window.api?.unity
  if (handlerUsageCounts.get(key) !== 0 || !unity) {
    return true
  }
  void cachedUsages(key, () =>
    unity.findMethodAssetUsages({ scriptPath: filePath, methodName })
  ).then((usages) => {
    const count = usages.reduce((sum, usage) => sum + usage.count, 0)
    if (count > 0) {
      handlerUsageCounts.set(key, count)
      refresh()
    }
  })
  return false
}

export function monacoRangeOfSpan(
  model: Monaco.editor.ITextModel,
  span: { start: number; end: number }
): Monaco.IRange {
  const start = model.getPositionAt(span.start)
  const end = model.getPositionAt(span.end)
  return {
    startLineNumber: start.lineNumber,
    startColumn: start.column,
    endLineNumber: end.lineNumber,
    endColumn: end.column
  }
}

function eventLensTitle(lens: Extract<UnityInsightLens, { kind: 'event' }>): string {
  const parts = [
    `${LENS_ICONS.event} ${translate('auto.lib.unity.lens.eventFunction', 'Unity event function')}`
  ]
  if (lens.message.performanceCritical) {
    parts.push(translate('auto.lib.unity.lens.frequentlyCalled', 'frequently called'))
  }
  if (lens.coroutine) {
    parts.push(translate('auto.lib.unity.lens.coroutine', 'coroutine'))
  }
  return parts.join(' · ')
}

function toCodeLens(
  model: Monaco.editor.ITextModel,
  insight: UnityModelInsight,
  lens: UnityInsightLens
): UnityCodeLens {
  const range = monacoRangeOfSpan(model, lens.span)
  switch (lens.kind) {
    case 'event':
      return {
        range,
        command: {
          id: lens.message.docsTopic ? OPEN_UNITY_DOCS_COMMAND : '',
          title: eventLensTitle(lens),
          tooltip: lens.message.description,
          arguments: lens.message.docsTopic
            ? [{ projectRoot: insight.project.projectRoot, topic: lens.message.docsTopic }]
            : undefined
        }
      }
    case 'serialized':
      return {
        range,
        command: {
          id: '',
          title: `${LENS_ICONS.field} ${translate('auto.lib.unity.lens.serializable', 'Serializable')}`,
          tooltip: translate(
            'auto.lib.unity.lens.serializableTooltip',
            'Unity serializes this value; it is stored in scenes, prefabs and assets.'
          )
        }
      }
    case 'asset-usages':
    case 'handler-usages':
      // Counted lazily in resolveCodeLens so only visible lenses scan the project's assets.
      return { range, unity: { lens, modelUri: model.uri.toString() } }
  }
}

async function resolveUsageLens(
  model: Monaco.editor.ITextModel,
  codeLens: UnityCodeLens,
  refresh: () => void
): Promise<UnityCodeLens> {
  const insight = unityInsightForModel(model)
  const lens = codeLens.unity?.lens
  const unity = window.api?.unity
  if (
    !insight ||
    !lens ||
    !unity ||
    (lens.kind !== 'asset-usages' && lens.kind !== 'handler-usages')
  ) {
    return codeLens
  }
  const usages =
    lens.kind === 'asset-usages'
      ? await cachedUsages(`script|${insight.filePath}`, () =>
          unity.findScriptAssetUsages({ scriptPath: insight.filePath })
        )
      : await cachedUsages(handlerUsageKey(insight.filePath, lens.methodName), () =>
          unity.findMethodAssetUsages({ scriptPath: insight.filePath, methodName: lens.methodName })
        )
  const count = usages.reduce((sum, usage) => sum + usage.count, 0)
  if (lens.kind === 'handler-usages') {
    const key = handlerUsageKey(insight.filePath, lens.methodName)
    const previous = handlerUsageCounts.get(key)
    handlerUsageCounts.set(key, count)
    if (count === 0) {
      // No placeholder: unbound public methods stay quiet, so re-provide without this lens row.
      if (previous !== 0) {
        refresh()
      }
      return { range: codeLens.range }
    }
  }
  return {
    range: codeLens.range,
    command:
      count === 0
        ? {
            id: '',
            title: `${LENS_ICONS.file} ${translate('auto.lib.unity.lens.noAssetUsages', 'No asset usages')}`,
            tooltip: translate(
              'auto.lib.unity.lens.noAssetUsagesTooltip',
              'No scene, prefab or asset references this script.'
            )
          }
        : {
            id: SHOW_UNITY_ASSET_USAGES_COMMAND,
            title:
              lens.kind === 'asset-usages'
                ? `${LENS_ICONS.file} ${
                    count === 1
                      ? translate('auto.lib.unity.lens.assetUsageOne', '1 asset usage')
                      : translate('auto.lib.unity.lens.assetUsageOther', '{{count}} asset usages', {
                          count
                        })
                  }`
                : `${LENS_ICONS.event} ${
                    count === 1
                      ? translate('auto.lib.unity.lens.handlerUsageOne', '1 event handler usage')
                      : translate(
                          'auto.lib.unity.lens.handlerUsageOther',
                          '{{count}} event handler usages',
                          { count }
                        )
                  }`,
            tooltip: usages
              .map((usage) => usage.assetPath.replace(/^.*[\\/]Assets[\\/]/, 'Assets/'))
              .join('\n'),
            arguments: [
              {
                modelUri: model.uri.toString(),
                lineNumber: codeLens.range.startLineNumber,
                column: codeLens.range.startColumn,
                usages
              }
            ]
          }
  }
}

export function registerUnityCodeLensProvider(monaco: MonacoModule): void {
  const changed = new monaco.Emitter<Monaco.languages.CodeLensProvider>()
  const provider: Monaco.languages.CodeLensProvider = {
    onDidChange: changed.event,
    provideCodeLenses(model) {
      const insight = unityInsightForModel(model)
      if (!insight?.analysis) {
        return null
      }
      return {
        lenses: insight.analysis.lenses
          .filter(
            (lens) =>
              lens.kind !== 'handler-usages' ||
              wantsHandlerLens(insight.filePath, lens.methodName, refresh)
          )
          .map((lens) => toCodeLens(model, insight, lens)),
        dispose: () => {}
      }
    },
    resolveCodeLens(model, codeLens: UnityCodeLens) {
      return codeLens.unity ? resolveUsageLens(model, codeLens, refresh) : codeLens
    }
  }
  const refresh = (): void => changed.fire(provider)
  onUnityInsightChanged(refresh)
  monaco.languages.registerCodeLensProvider('csharp', provider)
}
