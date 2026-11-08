import { translate } from '@/i18n/i18n'
import type * as Monaco from 'monaco-editor'
import { toast } from 'sonner'
import type { Hover, Location, LocationLink } from 'vscode-languageserver-protocol'
import { requestLsp } from '@/lib/lsp/lsp-client'
import { pathFromLspUri } from '@/lib/lsp/lsp-file-uri'
import { lspBindingFor, lspPositionParams } from '@/lib/lsp/lsp-provider-binding-access'
import { lspHoverSignature } from './unity-class-resolver'
import { unityInsightForModel, unityOutlineForModel } from './unity-insight-model-state'

type MonacoModule = typeof Monaco

export const OPEN_UNITY_DOCS_COMMAND = 'orca.unity.openDocs'

export type OpenUnityDocsArgs = { projectRoot: string; topic: string }

let commandRegistered = false

export async function openUnityDocs({ projectRoot, topic }: OpenUnityDocsArgs): Promise<void> {
  const result = await window.api?.unity?.openDocs({ projectRoot, topic })
  if (result && !result.ok) {
    toast.error(
      translate(
        'auto.lib.unity.docs.openFailed',
        'Could not open Unity documentation for {{topic}}',
        { topic }
      ),
      {
        description: result.error
      }
    )
  }
}

export function ensureUnityDocsCommand(monaco: MonacoModule): void {
  if (commandRegistered) {
    return
  }
  commandRegistered = true
  monaco.editor.registerCommand(
    OPEN_UNITY_DOCS_COMMAND,
    (_accessor, args: OpenUnityDocsArgs | undefined) => {
      if (args?.projectRoot && args.topic) {
        void openUnityDocs(args)
      }
    }
  )
}

/** Trusted-markdown link that opens a docs topic through the Unity CLI. */
export function unityDocsMarkdownLink(
  projectRoot: string,
  topic: string,
  label = translate('auto.lib.unity.docs.linkLabel', 'Open Unity documentation')
): string {
  const args = encodeURIComponent(
    JSON.stringify([{ projectRoot, topic } satisfies OpenUnityDocsArgs])
  )
  return `[${label}](command:${OPEN_UNITY_DOCS_COMMAND}?${args})`
}

/** Scripting-reference topic for a fully-qualified Unity type (`UnityEngine.Playables.X` → `Playables.X`). */
function topicForQualifiedType(qualified: string): string | null {
  const match = qualified.match(/^(?:UnityEngine|UnityEditor)\.(.+)$/)
  return match ? match[1] : null
}

function firstLocation(
  result: Location | Location[] | LocationLink[] | null | undefined
): string | null {
  const first = Array.isArray(result) ? result[0] : result
  if (!first) {
    return null
  }
  return 'targetUri' in first ? first.targetUri : first.uri
}

/** Decompiled metadata Roslyn generated for a Unity assembly (`#region Assembly UnityEngine.CoreModule`). */
async function isUnityMetadataSource(uri: string | null): Promise<boolean> {
  const filePath = uri ? pathFromLspUri(uri) : null
  if (!filePath || !/[\\/]MetadataAsSource[\\/]/.test(filePath)) {
    return false
  }
  try {
    const { content } = await window.api.fs.readFile({ filePath })
    return /#region Assembly (?:UnityEngine|UnityEditor|Unity\.)/.test(content.slice(0, 2000))
  } catch {
    return false
  }
}

/** Ask the C# server what the caret symbol is; only Unity API symbols yield a topic. */
async function topicFromLanguageServer(
  model: Monaco.editor.ITextModel,
  position: Monaco.IPosition
): Promise<string | null | undefined> {
  const binding = lspBindingFor(model)
  if (!binding || binding.session.status !== 'ready') {
    return undefined
  }
  const params = lspPositionParams(binding, position)
  const signature = lspHoverSignature(
    await requestLsp<Hover | null>(binding.session, 'textDocument/hover', params)
  )
  if (!signature) {
    return undefined
  }
  const typeMatch = signature.match(/^(?:class|struct|interface|enum|delegate|record)\s+([\w.]+)/)
  if (typeMatch) {
    return topicForQualifiedType(typeMatch[1])
  }
  // Members render as `<type> Type.Member(...)`; locals/parameters/fields are prefixed `(kind)`.
  if (!signature.startsWith('(')) {
    const member = signature
      .replace(/<[^<>]*>/g, '')
      .replace(/<[^<>]*>/g, '')
      .match(/([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*(?:\(|\{|=|$)/)
    const definition = member
      ? await requestLsp<Location | Location[] | LocationLink[] | null>(
          binding.session,
          'textDocument/definition',
          params
        )
      : null
    if (member && (await isUnityMetadataSource(firstLocation(definition)))) {
      return `${member[1]}.${member[2]}`
    }
  }
  // Variables and user members of Unity types: document the type itself.
  const typeDefinition = firstLocation(
    await requestLsp<Location | Location[] | LocationLink[] | null>(
      binding.session,
      'textDocument/typeDefinition',
      params
    )
  )
  if (!(await isUnityMetadataSource(typeDefinition))) {
    return null
  }
  return (
    pathFromLspUri(typeDefinition ?? '')
      ?.replace(/^.*[\\/]/, '')
      .replace(/\.cs$/i, '') ?? null
  )
}

/** Without a server: `Type.Member` for static-looking access, else the word itself. */
function topicFromText(model: Monaco.editor.ITextModel, position: Monaco.IPosition): string | null {
  const outline = unityOutlineForModel(model)
  const word = model.getWordAtPosition(position)
  if (!outline || !word) {
    return null
  }
  const offset = model.getOffsetAt({ lineNumber: position.lineNumber, column: word.startColumn })
  const index = outline.tokens.findIndex((token) => token.start === offset)
  const receiver =
    index >= 2 && outline.tokens[index - 1].text === '.' ? outline.tokens[index - 2] : null
  if (receiver?.kind === 'identifier' && /^[A-Z]/.test(receiver.text)) {
    return `${receiver.text}.${word.word}`
  }
  return /^[A-Z]/.test(word.word) ? word.word : null
}

/** Documentation topic for the symbol at `position` in a Unity C# model. */
export async function resolveUnityDocsTopic(
  model: Monaco.editor.ITextModel,
  position: Monaco.IPosition
): Promise<string | null> {
  const insight = unityInsightForModel(model)
  if (insight?.analysis) {
    const offset = model.getOffsetAt(position)
    const lens = insight.analysis.lenses.find(
      (candidate) =>
        candidate.kind === 'event' && candidate.span.start <= offset && offset <= candidate.span.end
    )
    if (lens?.kind === 'event' && lens.message.docsTopic) {
      return lens.message.docsTopic
    }
  }
  const fromServer = await topicFromLanguageServer(model, position)
  return fromServer === undefined ? topicFromText(model, position) : fromServer
}

/** Shift+F1 / context-menu action, added only to editors showing Unity C# files. */
export function addOpenUnityDocsAction(
  monaco: MonacoModule,
  editor: Monaco.editor.IStandaloneCodeEditor
): Monaco.IDisposable {
  return editor.addAction({
    id: 'orca.unity.openDocumentation',
    label: translate('auto.lib.unity.docs.openAction', 'Open Unity Documentation'),
    keybindings: [monaco.KeyMod.Shift | monaco.KeyCode.F1],
    contextMenuGroupId: 'navigation',
    contextMenuOrder: 1.8,
    run: async (current) => {
      const model = current.getModel()
      const position = current.getPosition()
      const insight = model ? unityInsightForModel(model) : undefined
      if (!model || !position || !insight) {
        return
      }
      const topic = await resolveUnityDocsTopic(model, position)
      if (!topic) {
        toast.message(
          translate(
            'auto.lib.unity.docs.noTopic',
            'No Unity documentation for the symbol at the caret'
          )
        )
        return
      }
      await openUnityDocs({ projectRoot: insight.project.projectRoot, topic })
    }
  })
}
