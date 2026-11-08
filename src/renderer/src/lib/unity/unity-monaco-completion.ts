import { translate } from '@/i18n/i18n'
import type * as Monaco from 'monaco-editor'
import {
  unityEventCompletionContext,
  unityEventCompletionDocumentation,
  unityEventCompletionItems
} from './unity-event-completion'
import { unityDocsMarkdownLink } from './unity-docs'
import {
  unityInsightForModel,
  unityOutlineForModel,
  unityTypeKindsForModel
} from './unity-insight-model-state'
import { findUnityStringSlots, unityStringSlotAtOffset } from './unity-string-literal-context'
import { unityStringSlotCandidates } from './unity-string-literal-validation'

type MonacoModule = typeof Monaco

export function registerUnityCompletionProvider(monaco: MonacoModule): void {
  monaco.languages.registerCompletionItemProvider('csharp', {
    triggerCharacters: ['"'],
    provideCompletionItems(model, position) {
      const insight = unityInsightForModel(model)
      const outline = insight ? unityOutlineForModel(model) : null
      if (!insight || !outline) {
        return null
      }
      const offset = model.getOffsetAt(position)
      const slot = unityStringSlotAtOffset(findUnityStringSlots(outline.tokens), offset)
      if (slot) {
        const start = model.getPositionAt(slot.contentSpan.start)
        const end = model.getPositionAt(slot.contentSpan.end)
        const range = new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column)
        return {
          suggestions: unityStringSlotCandidates(insight.project, slot.kind).map(
            (candidate, index) => ({
              label: { label: candidate.label, description: candidate.detail },
              kind: monaco.languages.CompletionItemKind.Value,
              insertText: candidate.label,
              range,
              sortText: `!${String(index).padStart(4, '0')}`,
              detail: `${slot.api} · ${candidate.detail}`
            })
          )
        }
      }
      const context = unityEventCompletionContext(
        outline,
        offset,
        unityTypeKindsForModel(model, outline)
      )
      if (!context) {
        return null
      }
      const start = model.getPositionAt(context.replaceStart)
      const end = model.getPositionAt(context.replaceEnd)
      const range = new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column)
      return {
        suggestions: unityEventCompletionItems(context).map((item) => {
          const parameters = item.message.parameters.map((p) => `${p.type} ${p.name}`).join(', ')
          return {
            label: {
              label: item.label,
              detail: `(${parameters})`,
              description: item.coroutine
                ? translate('auto.lib.unity.completion.coroutine', 'Unity coroutine')
                : translate('auto.lib.unity.completion.eventFunction', 'Unity event function')
            },
            kind: monaco.languages.CompletionItemKind.Event,
            insertText: item.insertText,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            filterText: item.filterText,
            range,
            // Ahead of same-scoring server items; Monaco ranks match quality first.
            sortText: `!${item.coroutine ? '1' : '0'}${item.label}`,
            documentation: {
              value: unityEventCompletionDocumentation(
                item,
                item.message.docsTopic
                  ? unityDocsMarkdownLink(insight.project.projectRoot, item.message.docsTopic)
                  : null
              ),
              isTrusted: true
            }
          }
        })
      }
    }
  })
}
