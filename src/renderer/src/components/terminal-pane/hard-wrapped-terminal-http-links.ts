import type { IBufferLine } from '@xterm/xterm'
import {
  TERMINAL_HTTP_URL_MAX_HARD_WRAPPED_ROWS,
  TERMINAL_HTTP_URL_MAX_LENGTH
} from './terminal-http-link-limits'
import { translateLineWithColumns, type WrappedLogicalLine } from './wrapped-terminal-link-ranges'

const HTTP_SCHEME_PATTERN = /https?:\/\//i
const HTTP_SCHEME_START_PATTERN = /^https?:\/\//i
const HTTP_FRAGMENT_PATTERN = /^[^\s"'!*(){}|\\^<>`│┃║╎╏┆┇┊┋]*/
const VERTICAL_LAYOUT_FRAME_PATTERN = /[│┃║╎╏┆┇┊┋|]/
const NON_LAYOUT_SUFFIX_PATTERN = /[^\s│┃║╎╏┆┇┊┋|]/
const HARD_WRAP_CONTINUATION_SUFFIX_PATTERN = /[/?&=#%+:-]$/
const MIN_HARD_WRAPPED_HTTP_ROWS = 3
const MIN_HARD_WRAP_FILL_RATIO = 0.8
// Openers the fragment pattern excludes, so the URL itself can never contain them.
const HTTP_URL_CLOSERS: Readonly<Record<string, string>> = { '(': ')', '<': '>' }

type TranslatedLine = ReturnType<typeof translateLineWithColumns>

function lastLayoutFrameIndexBefore(text: string, endIndex: number): number {
  for (let index = endIndex - 1; index >= 0; index--) {
    if (VERTICAL_LAYOUT_FRAME_PATTERN.test(text[index]!)) {
      return index
    }
  }
  return -1
}

function buildCandidateFromStart(
  buffer: { getLine(y: number): IBufferLine | undefined },
  startY: number,
  currentY: number,
  translatedLines: Map<number, TranslatedLine>
): WrappedLogicalLine | null {
  const startLine = buffer.getLine(startY)
  if (!startLine) {
    return null
  }
  const cachedStart = translatedLines.get(startY)
  const startText = cachedStart?.text ?? startLine.translateToString(false)
  const schemeIndex = startText.search(HTTP_SCHEME_PATTERN)
  const leftFrameIndex =
    schemeIndex === -1 ? -1 : lastLayoutFrameIndexBefore(startText, schemeIndex)
  if (leftFrameIndex === -1) {
    return null
  }
  const translatedStart = cachedStart ?? translateLineWithColumns(startLine)
  translatedLines.set(startY, translatedStart)
  const schemeColumn = translatedStart.columns[schemeIndex]
  const leftFrameColumn = translatedStart.columns[leftFrameIndex]
  let contentStartIndex = leftFrameIndex + 1
  while (contentStartIndex < schemeIndex && translatedStart.text[contentStartIndex] === ' ') {
    contentStartIndex++
  }
  const contentStartColumn = translatedStart.columns[contentStartIndex]
  if (
    schemeColumn === undefined ||
    leftFrameColumn === undefined ||
    contentStartColumn === undefined
  ) {
    return null
  }
  const cellPadding = contentStartColumn - leftFrameColumn - 1
  // Why: `(https://…` wrapped inside a cell is unbalanced until a later row closes it.
  const closer =
    schemeIndex - 1 > leftFrameIndex
      ? HTTP_URL_CLOSERS[translatedStart.text[schemeIndex - 1]!]
      : undefined

  let text = ''
  let rightFrameColumn: number | null = null
  let previousRowCanContinue = true
  let previousRowTightlyFilled = false
  let startRowFilled = false
  let startRowTightlyFilled = false
  const rows: WrappedLogicalLine['rows'] = []

  for (let rowY = startY; rowY < startY + TERMINAL_HTTP_URL_MAX_HARD_WRAPPED_ROWS; rowY++) {
    if (rowY > startY && !previousRowCanContinue) {
      break
    }
    const line = buffer.getLine(rowY)
    if (!line) {
      break
    }
    const translated =
      rowY === startY
        ? translatedStart
        : (translatedLines.get(rowY) ?? translateLineWithColumns(line))
    translatedLines.set(rowY, translated)

    let fragmentStart = schemeIndex
    if (rowY > startY) {
      const rowLeftFrameIndex = translated.columns.indexOf(leftFrameColumn)
      if (
        rowLeftFrameIndex === -1 ||
        !VERTICAL_LAYOUT_FRAME_PATTERN.test(translated.text[rowLeftFrameIndex] ?? '')
      ) {
        break
      }
      fragmentStart = rowLeftFrameIndex + 1
      while (translated.text[fragmentStart] === ' ') {
        fragmentStart++
      }
      // Why: TUIs resume wrapped cell text at the cell's content edge, or hang it under the scheme.
      const fragmentStartColumn = translated.columns[fragmentStart]
      if (fragmentStartColumn !== contentStartColumn && fragmentStartColumn !== schemeColumn) {
        break
      }
    }

    const fragment = translated.text.slice(fragmentStart).match(HTTP_FRAGMENT_PATTERN)?.[0] ?? ''
    if (!fragment || (rowY > startY && HTTP_SCHEME_START_PATTERN.test(fragment))) {
      break
    }
    const fragmentEnd = fragmentStart + fragment.length
    const rowSuffix = translated.text.slice(fragmentEnd)
    const rightFrameOffset = rowSuffix.search(VERTICAL_LAYOUT_FRAME_PATTERN)
    const currentRightFrameIndex = rightFrameOffset === -1 ? -1 : fragmentEnd + rightFrameOffset
    const currentRightFrameColumn = translated.columns[currentRightFrameIndex]
    // Why: only this cell matters; table columns to the right carry unrelated text.
    const cellSuffix = rowSuffix.slice(0, Math.max(0, rightFrameOffset))
    // Why: cell text may follow the URL only after the closer of its unbalanced opener.
    const closesUrl =
      rowY > startY &&
      closer !== undefined &&
      previousRowTightlyFilled &&
      cellSuffix.startsWith(closer)
    if (
      currentRightFrameIndex === -1 ||
      currentRightFrameColumn === undefined ||
      (rightFrameColumn !== null && currentRightFrameColumn !== rightFrameColumn) ||
      (NON_LAYOUT_SUFFIX_PATTERN.test(cellSuffix) && !closesUrl)
    ) {
      break
    }
    rightFrameColumn ??= currentRightFrameColumn

    if (text.length + fragment.length > TERMINAL_HTTP_URL_MAX_LENGTH) {
      return null
    }

    rows.push({
      y: rowY,
      text: fragment,
      sourceText: translated.text,
      columns: translated.columns.slice(fragmentStart, fragmentEnd + 1),
      startIndex: text.length,
      isWrapped: line.isWrapped,
      lineLength: line.length
    })
    text += fragment
    if (closesUrl) {
      break
    }

    const fragmentEndColumn = translated.columns[fragmentEnd]!
    const contentWidth = currentRightFrameColumn - schemeColumn
    const fragmentWidth = fragmentEndColumn - schemeColumn
    const fillsRow = contentWidth > 0 && fragmentWidth / contentWidth >= MIN_HARD_WRAP_FILL_RATIO
    // Why: character-wrapped cells leave at most the mirrored left padding before the frame.
    previousRowTightlyFilled = currentRightFrameColumn - fragmentEndColumn <= cellPadding + 1
    if (rowY === startY) {
      startRowFilled = fillsRow
      startRowTightlyFilled = previousRowTightlyFilled
    }
    previousRowCanContinue =
      HARD_WRAP_CONTINUATION_SUFFIX_PATTERN.test(fragment) || fillsRow || previousRowTightlyFilled
  }

  const hasUnclosedOpener = closer !== undefined && startRowTightlyFilled
  if (
    rows.length > 1 &&
    !hasUnclosedOpener &&
    (rows.length < MIN_HARD_WRAPPED_HTTP_ROWS || !startRowFilled)
  ) {
    // Why: a short complete URL can legitimately end in `/`; one adjacent
    // framed token is not enough evidence that the URL continued onto it.
    rows.splice(1)
    text = rows[0]?.text ?? ''
  }
  if (rows.at(-1)?.y === undefined || rows.at(-1)!.y < currentY) {
    return null
  }
  return {
    text,
    rows,
    fingerprint: `hard-http:${rows.map((row) => `${row.y}:${row.sourceText}`).join('\0')}`
  }
}

export function buildHardWrappedHttpLogicalLineCandidates(
  buffer: { getLine(y: number): IBufferLine | undefined },
  bufferLineNumber: number
): WrappedLogicalLine[] {
  const currentY = bufferLineNumber - 1
  const currentLine = buffer.getLine(currentY)
  if (!currentLine || !VERTICAL_LAYOUT_FRAME_PATTERN.test(currentLine.translateToString(false))) {
    // Why: cursor-positioned hard wraps require a stable vertical frame; most
    // terminal clicks can avoid the bounded backward scan entirely.
    return []
  }
  const candidates: WrappedLogicalLine[] = []
  const translatedLines = new Map<number, TranslatedLine>()
  const minY = Math.max(0, currentY - TERMINAL_HTTP_URL_MAX_HARD_WRAPPED_ROWS + 1)
  for (let startY = currentY; startY >= minY; startY--) {
    const candidate = buildCandidateFromStart(buffer, startY, currentY, translatedLines)
    if (candidate) {
      candidates.push(candidate)
    }
  }
  return candidates.sort(
    (left, right) => right.rows.length - left.rows.length || right.text.length - left.text.length
  )
}
