import type { IRange } from 'monaco-editor'
import type { FileDiff as NativeFileDiff } from '@pierre/diffs'

export type ProjectedLine = {
  lineNumber: number
  top: number
  bottom: number
  left: number
  right: number
}

export type ProjectionBounds = {
  left: number
  top: number
  width: number
  height: number
}

export type ProjectionViewport = {
  left: number
  right: number
}

const MODIFIED_LINE_SELECTOR =
  '[data-code][data-additions] [data-content] > [data-line], ' +
  '[data-code][data-unified] [data-content] > [data-line]:not([data-line-type="change-deletion"])'

export function collectProjectedLines(
  root: ShadowRoot | HTMLElement,
  lineCount: number
): ProjectedLine[] {
  const linesByNumber = new Map<number, ProjectedLine>()
  for (const element of root.querySelectorAll<HTMLElement>(MODIFIED_LINE_SELECTOR)) {
    // Pierre writes the canonical modified line number to data-line. data-line-index
    // is a distinct unified/split virtual-row pair and must not drive the model.
    const lineNumber = Number(element.dataset.line)
    if (!Number.isInteger(lineNumber) || lineNumber < 1 || lineNumber > lineCount) {
      continue
    }
    const rect = element.getBoundingClientRect()
    if (rect.height <= 0 || rect.width <= 0) {
      continue
    }
    const existing = linesByNumber.get(lineNumber)
    if (!existing || rect.top < existing.top) {
      linesByNumber.set(lineNumber, {
        lineNumber,
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right
      })
    }
  }
  return [...linesByNumber.values()].sort(
    (left, right) => left.top - right.top || left.lineNumber - right.lineNumber
  )
}

type PierreHunk = {
  additionCount: number
  additionStart: number
  collapsedBefore: number
}

type NativeExpansionState = {
  fileDiff?: {
    isPartial: boolean
    hunks: readonly PierreHunk[]
  }
  options: {
    collapsedContextThreshold?: number
    expandUnchanged?: boolean
  }
  hunksRenderer?: {
    getExpandedHunksMap: () => ReadonlyMap<number, { fromEnd: number; fromStart: number }>
  }
}

export type NativeHiddenAreasSnapshot = {
  areas: IRange[]
  key: string
}

// Pierre exposes the renderability oracle publicly but not its expansion map.
// This read-only renderer state is the same state that its own layout uses;
// using it avoids confusing virtualized-away rows with collapsed context.
export function getNativeHiddenAreasSnapshot<LAnnotation>(
  nativeFileDiff: NativeFileDiff<LAnnotation>,
  modelLineCount: number
): NativeHiddenAreasSnapshot {
  const nativeExpansionState = nativeFileDiff as unknown as NativeExpansionState
  const fileDiff = nativeExpansionState.fileDiff
  const expandedHunks = nativeExpansionState.hunksRenderer?.getExpandedHunksMap()
  const threshold = nativeExpansionState.options.collapsedContextThreshold ?? 1
  const expansionKey = expandedHunks
    ? [...expandedHunks]
        .map(([index, region]) => `${index}:${region.fromStart}:${region.fromEnd}`)
        .join(',')
    : ''
  const hunkKey = fileDiff?.hunks
    .map((hunk) => `${hunk.additionStart}:${hunk.additionCount}:${hunk.collapsedBefore}`)
    .join(',')
  const key = `${modelLineCount}:${fileDiff?.isPartial === true}:${nativeExpansionState.options.expandUnchanged === true}:${threshold}:${hunkKey}:${expansionKey}`
  if (!fileDiff || fileDiff.isPartial || nativeExpansionState.options.expandUnchanged === true) {
    return { areas: [], key }
  }

  const areas: IRange[] = []
  const addCollapsedRange = (
    startLineNumber: number,
    rangeSize: number,
    expansion: { fromEnd: number; fromStart: number } | undefined,
    trailing = false
  ): void => {
    if (rangeSize <= threshold) {
      return
    }
    const fromStart = Math.min(Math.max(expansion?.fromStart ?? 0, 0), rangeSize)
    const fromEnd = trailing ? 0 : Math.min(Math.max(expansion?.fromEnd ?? 0, 0), rangeSize)
    const endLineNumber = startLineNumber + rangeSize - fromEnd - 1
    const collapsedStart = startLineNumber + fromStart
    if (collapsedStart > endLineNumber) {
      return
    }
    areas.push({ startLineNumber: collapsedStart, startColumn: 1, endLineNumber, endColumn: 1 })
  }

  for (const [index, hunk] of fileDiff.hunks.entries()) {
    const hunkStart = hunk.additionStart + (hunk.additionCount === 0 ? 1 : 0)
    addCollapsedRange(
      hunkStart - hunk.collapsedBefore,
      hunk.collapsedBefore,
      expandedHunks?.get(index)
    )
  }
  const lastHunk = fileDiff.hunks.at(-1)
  if (lastHunk) {
    const trailingStart =
      lastHunk.additionStart + lastHunk.additionCount + (lastHunk.additionCount === 0 ? 1 : 0)
    addCollapsedRange(
      trailingStart,
      modelLineCount - trailingStart + 1,
      expandedHunks?.get(fileDiff.hunks.length),
      true
    )
  }
  return { areas, key }
}

export function getProjectionBounds(
  lines: readonly ProjectedLine[],
  positioningRect: DOMRect
): ProjectionBounds {
  const firstLine = lines[0]!
  const lastLine = lines.at(-1)!
  let left = firstLine.left
  let right = firstLine.right
  for (const line of lines) {
    left = Math.min(left, line.left)
    right = Math.max(right, line.right)
  }
  return {
    left: left - positioningRect.left,
    top: firstLine.top - positioningRect.top,
    width: Math.max(1, right - left),
    height: Math.max(1, lastLine.bottom - firstLine.top)
  }
}

/**
 * The native code grid owns horizontal scrolling. Its content column keeps a
 * stable viewport after its sticky gutter while the projected rows move with
 * scrollLeft, so the overlay is sized to this viewport and scrolls Monaco to match.
 */
export function getProjectionViewport(
  line: HTMLElement,
  positioningRect: DOMRect
): ProjectionViewport | undefined {
  const content = line.closest<HTMLElement>('[data-content]')
  const code = line.closest<HTMLElement>('[data-code]')
  if (!content || !code || code.scrollWidth <= code.clientWidth || code.clientWidth === 0) {
    return
  }
  const codeRect = code.getBoundingClientRect()
  const left = codeRect.left - positioningRect.left + code.clientLeft + content.offsetLeft
  const right = codeRect.left - positioningRect.left + code.clientLeft + code.clientWidth
  return right > left ? { left, right } : undefined
}

export function findProjectedLine(
  root: ShadowRoot | HTMLElement,
  lineNumber: number
): HTMLElement | null {
  return root.querySelector<HTMLElement>(
    `[data-code][data-additions] [data-content] > [data-line="${lineNumber}"], ` +
      `[data-code][data-unified] [data-content] > [data-line="${lineNumber}"]:not([data-line-type="change-deletion"])`
  )
}
