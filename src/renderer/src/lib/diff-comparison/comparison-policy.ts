import type { Grammar } from '@shikijs/core'
import { INITIAL } from '@shikijs/vscode-textmate'
import type { IToken } from '@shikijs/vscode-textmate'
import { getShikiHighlighter } from '../monaco-highlighting/shiki-highlighter'
import { getShikiLanguageCatalogEntry } from '../monaco-highlighting/shiki-language-catalog'
import { COMPARISON_BUDGET_MS } from './comparison-types'

export type LineProjection = {
  /** The CRLF-normalized physical source line. It is never displayed or saved. */
  raw: string
  /** The line given to the comparison engine. */
  projected: string
  /** UTF-16 source offset at which `projected` starts. */
  removedPrefixLength: number
  /** UTF-16 exclusive source offset at which `projected` ends. */
  retainedEndOffset: number
}

export type ComparisonProjection = {
  original: readonly LineProjection[]
  modified: readonly LineProjection[]
  /** False means no whitespace was hidden beyond CRLF encoding. */
  semantic: boolean
  /** Tokenization spent the bounded comparison budget. */
  quitEarly: boolean
}

type TokenizedLine = { line: string; tokens: readonly IToken[] }
type TokenizedDocument = { lines: readonly TokenizedLine[]; containsJsx: boolean }
type SupportedSemanticLanguage = 'javascript' | 'typescript' | 'json' | 'html'

const HORIZONTAL_ASCII_WHITESPACE = /^[\t ]+/
const TRAILING_HORIZONTAL_ASCII_WHITESPACE = /[\t ]+$/

function normalizeLanguage(language: string): SupportedSemanticLanguage | null {
  switch (language.toLowerCase()) {
    case 'javascript':
    case 'javascriptreact':
      return 'javascript'
    case 'typescript':
    case 'typescriptreact':
      return 'typescript'
    case 'json':
    case 'jsonc':
      return 'json'
    case 'html':
      return 'html'
    default:
      return null
  }
}

/** CRLF is an encoding difference only; lone CR is retained as source content. */
export function normalizeComparisonLineEndings(content: string): string {
  return content.replace(/\r\n/g, '\n')
}

export function createIdentityLineProjections(content: string): readonly LineProjection[] {
  return normalizeComparisonLineEndings(content)
    .split('\n')
    .map((raw) => ({
      raw,
      projected: raw,
      removedPrefixLength: 0,
      retainedEndOffset: raw.length
    }))
}

function isNonblankPhysicalLine(line: string): boolean {
  // A whitespace-only line can carry Markdown hard breaks and meaningful layout.
  return /[^\t ]/.test(line)
}

function isJsxScope(scope: string): boolean {
  return (
    (scope.endsWith('.jsx') || scope.endsWith('.tsx')) &&
    (scope.includes('meta.jsx') || scope.includes('meta.tag'))
  )
}

function containsJsxText(content: string): boolean {
  // The JavaScript grammar is not JSX-aware. This deliberately rejects a superset
  // of JSX rather than silently considering its text-node indentation cosmetic.
  return /<\/?[A-Za-z][\w:.-]*(?:\s|\/?>)/.test(content)
}

const CODE_SCOPE_PREFIXES = [
  'meta.block',
  'meta.objectliteral',
  'meta.array.literal',
  'meta.class',
  'meta.function',
  'meta.function.expression',
  'meta.parameters',
  'meta.var.expr',
  'meta.var-single-variable.expr',
  'meta.type.annotation',
  'meta.type.declaration',
  'meta.type.parameters',
  'meta.object.type',
  'meta.brace.square',
  'meta.brace.round',
  'meta.arrow'
]
const CODE_SCOPES = {
  javascript: new Set([
    'source.js',
    'source.jsx',
    ...CODE_SCOPE_PREFIXES.flatMap((prefix) => [`${prefix}.js`, `${prefix}.jsx`])
  ]),
  typescript: new Set([
    'source.ts',
    'source.tsx',
    ...CODE_SCOPE_PREFIXES.flatMap((prefix) => [`${prefix}.ts`, `${prefix}.tsx`])
  ]),
  json: new Set([
    'source.json',
    'source.json.comments',
    ...[
      'meta.structure.array',
      'meta.structure.dictionary',
      'meta.structure.dictionary.value'
    ].flatMap((prefix) => [`${prefix}.json`, `${prefix}.json.comments`])
  ])
}

function isRecognizedHtmlTagScope(scope: string): boolean {
  return /^meta\.tag(?:\.[\w-]+)*\.(?:start|end|void)\.html$/.test(scope)
}

function isAllowedHtmlScope(scope: string): boolean {
  if (scope === 'text.html.basic') {
    return true
  }
  if (/^meta\.element(?:\.[\w-]+)*\.html$/.test(scope)) {
    return true
  }
  if (isRecognizedHtmlTagScope(scope)) {
    return true
  }
  if (/^meta\.attribute(?:\.[\w-]+)*\.html$/.test(scope)) {
    return true
  }
  return false
}

function coversSafely(
  tokens: readonly IToken[],
  start: number,
  end: number,
  predicate: (scope: string) => boolean,
  requireScopes?: (scopes: readonly string[]) => boolean
): boolean {
  if (start === end) {
    return false
  }
  let coveredUntil = start
  for (const token of tokens) {
    if (token.endIndex <= start || token.startIndex >= end) {
      continue
    }
    if (token.startIndex > coveredUntil) {
      return false
    }
    if (!token.scopes.every(predicate)) {
      return false
    }
    if (requireScopes && !requireScopes(token.scopes)) {
      return false
    }
    coveredUntil = Math.max(coveredUntil, token.endIndex)
  }
  return coveredUntil >= end
}

function createProjectionForLine(
  raw: string,
  tokens: readonly IToken[],
  language: SupportedSemanticLanguage
): LineProjection {
  if (!isNonblankPhysicalLine(raw)) {
    return { raw, projected: raw, removedPrefixLength: 0, retainedEndOffset: raw.length }
  }

  const prefixLength = HORIZONTAL_ASCII_WHITESPACE.exec(raw)?.[0].length ?? 0
  const suffixLength = TRAILING_HORIZONTAL_ASCII_WHITESPACE.exec(raw)?.[0].length ?? 0
  const safelyCovers =
    language === 'html'
      ? (start: number, end: number) =>
          coversSafely(
            tokens,
            start,
            end,
            isAllowedHtmlScope,
            (scopes) => scopes.includes('text.html.basic') && scopes.some(isRecognizedHtmlTagScope)
          )
      : (start: number, end: number) =>
          coversSafely(tokens, start, end, (scope) =>
            CODE_SCOPES[language as 'javascript' | 'typescript' | 'json'].has(scope)
          )

  const removePrefix = prefixLength > 0 && safelyCovers(0, prefixLength)
  const suffixStart = raw.length - suffixLength
  // Do not let an all-whitespace candidate overlap itself. It was rejected above,
  // but this also makes the mapping invariant explicit for future policy changes.
  const removeSuffix =
    suffixLength > 0 &&
    suffixStart >= (removePrefix ? prefixLength : 0) &&
    safelyCovers(suffixStart, raw.length)
  const removedPrefixLength = removePrefix ? prefixLength : 0
  const retainedEndOffset = removeSuffix ? suffixStart : raw.length
  return {
    raw,
    projected: raw.slice(removedPrefixLength, retainedEndOffset),
    removedPrefixLength,
    retainedEndOffset
  }
}

async function tokenizeDocument(
  content: string,
  grammar: Grammar,
  deadline: number
): Promise<{ document: TokenizedDocument; quitEarly: boolean } | null> {
  const lines: TokenizedLine[] = []
  let ruleStack = INITIAL
  let containsJsx = false
  for (const line of normalizeComparisonLineEndings(content).split('\n')) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      return null
    }
    const result = grammar.tokenizeLine(line, ruleStack, remaining)
    if (result.stoppedEarly) {
      return null
    }
    ruleStack = result.ruleStack
    if (result.tokens.some((token) => token.scopes.some((scope) => scope.startsWith('invalid.')))) {
      return null
    }
    containsJsx ||= result.tokens.some((token) => token.scopes.some(isJsxScope))
    lines.push({ line, tokens: result.tokens })
  }
  // An unterminated string/comment/template leaves lexical context uncertain.
  // The grammar's root scope differs from INITIAL by identity, but an open
  // lexical construct necessarily leaves extra stack depth behind.
  if (ruleStack.depth > INITIAL.depth) {
    return null
  }
  return { document: { lines, containsJsx }, quitEarly: false }
}

/**
 * Projects only whitespace proven insignificant by a complete TextMate parse.
 * Any missing grammar, invalid/incomplete lexical state, or exhausted budget
 * falls back to literal lines (except CRLF encoding normalization).
 */
export async function createComparisonProjection({
  originalContent,
  modifiedContent,
  language,
  showWhitespace,
  budgetMs = COMPARISON_BUDGET_MS
}: {
  originalContent: string
  modifiedContent: string
  language: string
  showWhitespace: boolean
  budgetMs?: number
}): Promise<ComparisonProjection> {
  const literal = (): ComparisonProjection => ({
    original: createIdentityLineProjections(originalContent),
    modified: createIdentityLineProjections(modifiedContent),
    semantic: false,
    quitEarly: false
  })
  if (showWhitespace) {
    return literal()
  }

  const semanticLanguage = normalizeLanguage(language)
  if (!semanticLanguage) {
    return literal()
  }
  const catalogEntry = getShikiLanguageCatalogEntry(semanticLanguage)
  if (!catalogEntry) {
    return literal()
  }

  const deadline = Date.now() + budgetMs
  try {
    const [highlighter, languageModule] = await Promise.all([
      getShikiHighlighter(),
      catalogEntry.loadLanguage()
    ])
    if (Date.now() >= deadline) {
      return { ...literal(), quitEarly: true }
    }
    await highlighter.loadLanguage(languageModule.default)
    const grammar = highlighter.getLanguage(catalogEntry.shikiLanguage)
    const original = await tokenizeDocument(originalContent, grammar, deadline)
    const modified = await tokenizeDocument(modifiedContent, grammar, deadline)
    if (!original || !modified) {
      return { ...literal(), quitEarly: Date.now() >= deadline }
    }
    if (
      (semanticLanguage === 'javascript' || semanticLanguage === 'typescript') &&
      (original.document.containsJsx ||
        modified.document.containsJsx ||
        containsJsxText(originalContent) ||
        containsJsxText(modifiedContent))
    ) {
      return literal()
    }
    return {
      original: original.document.lines.map(({ line, tokens }) =>
        createProjectionForLine(line, tokens, semanticLanguage)
      ),
      modified: modified.document.lines.map(({ line, tokens }) =>
        createProjectionForLine(line, tokens, semanticLanguage)
      ),
      semantic: true,
      quitEarly: false
    }
  } catch {
    // Grammars are optional renderer assets; a load/tokenization failure must not
    // hide a source difference.
    return { ...literal(), quitEarly: Date.now() >= deadline }
  }
}

/** Converts a projected Monaco UTF-16 column to the original raw source column. */
export function mapProjectedColumnToRaw(
  projection: LineProjection,
  projectedColumn: number
): number {
  const projectedOffset = projectedColumn - 1
  const rawOffset =
    projectedOffset === projection.projected.length
      ? projection.retainedEndOffset
      : projection.removedPrefixLength + projectedOffset
  return rawOffset + 1
}
