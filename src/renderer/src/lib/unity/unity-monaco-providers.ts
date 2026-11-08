import { translate } from '@/i18n/i18n'
import type * as Monaco from 'monaco-editor'
import { ensureUnityAssetUsagePeek } from './unity-asset-usage-peek'
import { ensureUnityDocsCommand, unityDocsMarkdownLink } from './unity-docs'
import { unityInsightForModel } from './unity-insight-model-state'
import { monacoRangeOfSpan, registerUnityCodeLensProvider } from './unity-monaco-code-lens'
import { registerUnityCompletionProvider } from './unity-monaco-completion'

type MonacoModule = typeof Monaco

const LANGUAGE_ID = 'csharp'

let registered = false

function registerCodeActions(monaco: MonacoModule): void {
  monaco.languages.registerCodeActionProvider(
    LANGUAGE_ID,
    {
      provideCodeActions(model, _range, context) {
        const insight = unityInsightForModel(model)
        if (!insight?.analysis) {
          return null
        }
        const actions: Monaco.languages.CodeAction[] = []
        for (const marker of context.markers) {
          if (marker.source !== 'Unity') {
            continue
          }
          const diagnostic = insight.analysis.diagnostics.find((candidate) => {
            const range = monacoRangeOfSpan(model, candidate.span)
            return (
              candidate.fix &&
              candidate.message === marker.message &&
              range.startLineNumber === marker.startLineNumber &&
              range.startColumn === marker.startColumn
            )
          })
          if (!diagnostic?.fix) {
            continue
          }
          actions.push({
            title: diagnostic.fix.title,
            kind: 'quickfix',
            isPreferred: true,
            diagnostics: [marker],
            edit: {
              edits: [
                {
                  resource: model.uri,
                  versionId: model.getVersionId(),
                  textEdit: {
                    range: monacoRangeOfSpan(model, diagnostic.fix.span),
                    text: diagnostic.fix.text
                  }
                }
              ]
            }
          })
        }
        return { actions, dispose: () => {} }
      }
    },
    { providedCodeActionKinds: ['quickfix'] }
  )
}

function registerEventHover(monaco: MonacoModule): void {
  monaco.languages.registerHoverProvider(LANGUAGE_ID, {
    provideHover(model, position) {
      const insight = unityInsightForModel(model)
      if (!insight?.analysis) {
        return null
      }
      const offset = model.getOffsetAt(position)
      const lens = insight.analysis.lenses.find(
        (candidate) =>
          candidate.kind === 'event' &&
          candidate.span.start <= offset &&
          offset <= candidate.span.end
      )
      if (lens?.kind !== 'event') {
        return null
      }
      const lines = [
        `**${translate('auto.lib.unity.hover.eventFunction', 'Unity event function')}** — ${lens.message.description}`
      ]
      if (lens.message.performanceCritical) {
        lines.push(
          '',
          `_${translate('auto.lib.unity.hover.frequentlyCalled', 'Frequently called: expensive calls here are flagged.')}_`
        )
      }
      if (lens.message.docsTopic) {
        lines.push('', unityDocsMarkdownLink(insight.project.projectRoot, lens.message.docsTopic))
      }
      return {
        range: monacoRangeOfSpan(model, lens.span),
        contents: [{ value: lines.join('\n'), isTrusted: true }]
      }
    }
  })
}

/** Register Unity insight providers for C# once; each resolves its model's Unity state lazily. */
export function ensureUnityMonacoProviders(monaco: MonacoModule): void {
  if (registered) {
    return
  }
  registered = true
  ensureUnityDocsCommand(monaco)
  ensureUnityAssetUsagePeek(monaco)
  registerUnityCompletionProvider(monaco)
  registerUnityCodeLensProvider(monaco)
  registerCodeActions(monaco)
  registerEventHover(monaco)
}
