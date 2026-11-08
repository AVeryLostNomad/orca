import type * as Monaco from 'monaco-editor'
import type {
  Hover,
  Location,
  LocationLink,
  MarkedString,
  MarkupContent
} from 'vscode-languageserver-protocol'
import { requestLsp, type LspWorkspaceSession } from '@/lib/lsp/lsp-client'
import { lspUriFromPath, pathFromLspUri } from '@/lib/lsp/lsp-file-uri'
import { getLspBindingForModel } from '@/lib/lsp/lsp-document-binding'
import { parseCSharpOutline } from './csharp-syntax-outline'
import type { CSharpOutline } from './csharp-syntax-outline-types'
import type { UnityClassResolver, UnityTypeSource } from './unity-class-context'

type MonacoModule = typeof Monaco

/** Plain text of an LSP hover's contents. */
export function lspHoverText(hover: Hover | null | undefined): string {
  if (!hover) {
    return ''
  }
  const parts: (MarkupContent | MarkedString)[] = Array.isArray(hover.contents)
    ? hover.contents
    : [hover.contents]
  return parts.map((part) => (typeof part === 'string' ? part : part.value)).join('\n')
}

/** Symbol display line of a hover: the first fenced code line (markdown) or first line (plaintext). */
export function lspHoverSignature(hover: Hover | null | undefined): string | null {
  const text = lspHoverText(hover)
  const fenced = text.match(/```[\w-]*\r?\n([^\r\n]+)/)
  const line = fenced ? fenced[1] : text.split(/\r?\n/).find((candidate) => candidate.trim())
  return line?.trim() || null
}

/** LSP position (UTF-16 columns) of `offset` within `text`. */
export function lspPositionAt(text: string, offset: number): { line: number; character: number } {
  let line = 0
  let lineStart = 0
  for (let i = 0; i < offset; i++) {
    if (text.charCodeAt(i) === 10) {
      line++
      lineStart = i + 1
    }
  }
  const character = offset - lineStart
  // `\r\n` endings: a caret never sits between the two characters.
  return { line, character: text[offset - 1] === '\r' ? character - 1 : character }
}

function offsetAt(text: string, position: { line: number; character: number }): number {
  let offset = 0
  for (let line = 0; line < position.line; line++) {
    const next = text.indexOf('\n', offset)
    if (next === -1) {
      return text.length
    }
    offset = next + 1
  }
  return offset + position.character
}

function firstLocation(
  result: Location | Location[] | LocationLink[] | null | undefined
): Location | null {
  const first = Array.isArray(result) ? result[0] : result
  if (!first) {
    return null
  }
  return 'targetUri' in first ? { uri: first.targetUri, range: first.targetSelectionRange } : first
}

/** Text of a file, preferring an open (possibly unsaved) model. */
async function readCSharpSource(monaco: MonacoModule, filePath: string): Promise<string | null> {
  const open = monaco.editor
    .getModels()
    .find((model) => !model.isDisposed() && getLspBindingForModel(model)?.filePath === filePath)
  if (open) {
    return open.getValue()
  }
  try {
    const result = await window.api.fs.readFile({ filePath })
    return result.isBinary ? null : result.content
  } catch {
    return null
  }
}

const outlineCache = new Map<string, { text: string; outline: CSharpOutline }>()

function outlineForText(key: string, text: string): CSharpOutline {
  const cached = outlineCache.get(key)
  if (cached && cached.text === text) {
    return cached.outline
  }
  const outline = parseCSharpOutline(text)
  if (outlineCache.size > 64) {
    outlineCache.clear()
  }
  outlineCache.set(key, { text, outline })
  return outline
}

/** Types declared in other open C# models; the only cross-file source without a server. */
function findTypeInOpenModels(
  monaco: MonacoModule,
  simpleName: string,
  exclude: CSharpOutline
): UnityTypeSource | null {
  for (const model of monaco.editor.getModels()) {
    if (model.isDisposed() || model.getLanguageId() !== 'csharp') {
      continue
    }
    const outline = outlineForText(model.uri.toString(), model.getValue())
    if (outline.text === exclude.text) {
      continue
    }
    const type = outline.types.find((candidate) => candidate.name === simpleName)
    if (type) {
      return { type, outline, filePath: getLspBindingForModel(model)?.filePath ?? null }
    }
  }
  return null
}

/** Resolver backed by the C# language server when `session` is ready, else open models only. */
export function createUnityClassResolver(
  monaco: MonacoModule,
  session: LspWorkspaceSession | undefined,
  rootUri: { filePath: string; uri: string } | null
): UnityClassResolver {
  const findInOpenModels: UnityClassResolver['findType'] = async (simpleName, _base, from) =>
    findTypeInOpenModels(monaco, simpleName, from.outline)
  if (!session || session.status !== 'ready' || session.projectInitializationPending === true) {
    return { findType: findInOpenModels }
  }
  const server = session
  // Roslyn answers requests for closed project documents, so every file in the chain can be asked.
  const documentUri = (source: UnityTypeSource): string | null =>
    source.filePath === null
      ? null
      : rootUri && source.filePath === rootUri.filePath
        ? rootUri.uri
        : lspUriFromPath(source.filePath, server.serverId)
  return {
    async qualifiedBaseName(source, base) {
      const uri = documentUri(source)
      if (!uri) {
        return null
      }
      const hover = await requestLsp<Hover | null>(server, 'textDocument/hover', {
        textDocument: { uri },
        position: lspPositionAt(source.outline.text, base.nameSpan.start)
      })
      const signature = lspHoverSignature(hover)
      return signature?.match(/^(?:class|struct|interface|record)\s+([\w.]+)/)?.[1] ?? null
    },
    async findType(simpleName, base, from) {
      const uri = documentUri(from)
      if (!uri) {
        return findInOpenModels(simpleName, base, from)
      }
      const result = await requestLsp<Location | Location[] | LocationLink[] | null>(
        server,
        'textDocument/definition',
        {
          textDocument: { uri },
          position: lspPositionAt(from.outline.text, base.nameSpan.start)
        }
      )
      const location = firstLocation(result)
      const filePath = location ? pathFromLspUri(location.uri) : null
      // Decompiled metadata means a library type that is not a known Unity base.
      if (!location || !filePath || /[\\/]MetadataAsSource[\\/]/.test(filePath)) {
        return null
      }
      const text = await readCSharpSource(monaco, filePath)
      if (text === null) {
        return null
      }
      const outline = outlineForText(filePath, text)
      const targetOffset = offsetAt(text, location.range.start)
      const type =
        outline.types.find((candidate) => candidate.nameSpan.start === targetOffset) ??
        outline.types.find((candidate) => candidate.name === simpleName)
      return type ? { type, outline, filePath } : null
    }
  }
}
