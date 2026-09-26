import { parseDiffFromFile, SPLIT_WITH_NEWLINES } from '@pierre/diffs'
import type { FileContents, FileDiffMetadata } from '@pierre/diffs'
import { getLargeDiffRenderLimit } from '@/components/editor/large-diff-render-limit'
import type {
  ComparisonInput,
  ComparisonRequest,
  ComparisonResponse,
  PierreComparisonResult
} from './comparison-types'
import { COMPARISON_BUDGET_MS } from './comparison-types'
import { createComparisonProjection } from './comparison-policy'
import { computeProjectedMonacoDiff } from './monaco-lines-diff'

function projectPierreFile(
  file: FileContents | null,
  projectedContents: string
): FileContents | null {
  return file === null ? null : { ...file, contents: projectedContents }
}

function createPierreResult(
  input: Extract<ComparisonInput, { output: 'pierre' }>,
  projection: {
    original: readonly { projected: string }[]
    modified: readonly { projected: string }[]
    quitEarly: boolean
  }
): Omit<PierreComparisonResult, 'id' | 'originalVersion' | 'modifiedVersion'> {
  const projectedOldFile = projectPierreFile(
    input.oldFile,
    projection.original.map((line) => line.projected).join('\n')
  )
  const projectedNewFile = projectPierreFile(
    input.newFile,
    projection.modified.map((line) => line.projected).join('\n')
  )
  const parsed = parseDiffFromFile(projectedOldFile, projectedNewFile)
  // Pierre conflates empty text with /dev/null; preserve proven presence on both sides.
  const type =
    input.oldFile !== null &&
    input.newFile !== null &&
    (parsed.type === 'new' || parsed.type === 'deleted')
      ? input.oldFile.name === input.newFile.name
        ? 'change'
        : 'rename-changed'
      : parsed.type
  const fileDiff: FileDiffMetadata = {
    ...parsed,
    type,
    deletionLines: input.oldFile?.contents ? input.oldFile.contents.split(SPLIT_WITH_NEWLINES) : [],
    additionLines: input.newFile?.contents ? input.newFile.contents.split(SPLIT_WITH_NEWLINES) : []
  }
  return { output: 'pierre', fileDiff, quitEarly: projection.quitEarly }
}

/** Computes one bounded request, independent of worker queueing and caching. */
export async function computeComparison(request: ComparisonRequest): Promise<ComparisonResponse> {
  const admission = getLargeDiffRenderLimit({
    originalContent: request.originalContent,
    modifiedContent: request.modifiedContent
  })
  if (admission.limited) {
    throw new Error(`Diff comparison exceeds the ${admission.reason} rendering limit`)
  }
  const projection = await createComparisonProjection({
    originalContent: request.originalContent,
    modifiedContent: request.modifiedContent,
    language: request.language,
    showWhitespace: request.showWhitespace,
    budgetMs: COMPARISON_BUDGET_MS
  })
  if (request.output === 'pierre') {
    const pierre = createPierreResult(request, projection)
    return {
      ...pierre,
      id: request.id,
      originalVersion: request.originalVersion,
      modifiedVersion: request.modifiedVersion
    }
  }
  const computed = computeProjectedMonacoDiff({
    original: projection.original,
    modified: projection.modified,
    maxComputationTimeMs: COMPARISON_BUDGET_MS
  })
  return {
    id: request.id,
    originalVersion: request.originalVersion,
    modifiedVersion: request.modifiedVersion,
    output: 'monaco',
    changes: computed.changes,
    identical: request.originalContent === request.modifiedContent,
    quitEarly: projection.quitEarly || computed.quitEarly
  }
}
