import { translate } from '@/i18n/i18n'
import type * as Monaco from 'monaco-editor'
import type { UnityInsightAnalysis, UnityInsightOwner } from './unity-insight-analysis'

type MonacoModule = typeof Monaco

const OWNERS: UnityInsightOwner[] = ['unity:signature', 'unity:perf', 'unity:strings']

const SEVERITY: Record<'warning' | 'info' | 'hint', keyof typeof Monaco.MarkerSeverity> = {
  warning: 'Warning',
  info: 'Info',
  hint: 'Hint'
}

/** Publish an analysis as `unity:*` markers plus gutter pulses; returns the new decoration ids. */
export function applyUnityInsightMarkers(
  monaco: MonacoModule,
  model: Monaco.editor.ITextModel,
  analysis: UnityInsightAnalysis,
  decorationIds: string[]
): string[] {
  for (const owner of OWNERS) {
    monaco.editor.setModelMarkers(
      model,
      owner,
      analysis.diagnostics
        .filter((diagnostic) => diagnostic.owner === owner)
        .map((diagnostic) => {
          const start = model.getPositionAt(diagnostic.span.start)
          const end = model.getPositionAt(diagnostic.span.end)
          return {
            severity: monaco.MarkerSeverity[SEVERITY[diagnostic.severity]],
            message: diagnostic.message,
            source: 'Unity',
            code: diagnostic.code,
            startLineNumber: start.lineNumber,
            startColumn: start.column,
            endLineNumber: end.lineNumber,
            endColumn: end.column
          }
        })
    )
  }
  // Gutter pulse on methods that run every frame (directly or via a call chain).
  return model.deltaDecorations(
    decorationIds,
    analysis.performanceCritical.map((critical) => {
      const line = model.getPositionAt(critical.method.nameSpan.start).lineNumber
      const chain =
        critical.path.length > 1
          ? translate('auto.lib.unity.perf.calledFrom', 'Called from {{chain}}', {
              chain: critical.path.join(' → ')
            })
          : translate('auto.lib.unity.perf.calledEveryFrame', 'Unity calls {{root}} every frame', {
              root: critical.root
            })
      return {
        range: new monaco.Range(line, 1, line, 1),
        options: {
          glyphMarginClassName: 'codicon codicon-pulse orca-unity-perf-glyph',
          glyphMarginHoverMessage: {
            value: `**${translate('auto.lib.unity.perf.criticalContext', 'Performance-critical context')}**  \n${chain}`
          },
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
        }
      }
    })
  )
}

export function clearUnityInsightMarkers(
  monaco: MonacoModule,
  model: Monaco.editor.ITextModel,
  decorationIds: string[]
): void {
  for (const owner of OWNERS) {
    monaco.editor.setModelMarkers(model, owner, [])
  }
  model.deltaDecorations(decorationIds, [])
}
