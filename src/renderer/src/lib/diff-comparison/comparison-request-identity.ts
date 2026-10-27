import { getDiskBaselineSignature } from '@/components/editor/diff-content-signature'
import { COMPARISON_POLICY_VERSION, type ComparisonInput } from './comparison-types'

function sourceIdentity(input: ComparisonInput): readonly unknown[] {
  if (input.output !== 'pierre') {
    return []
  }
  return [
    input.oldFile?.name ?? null,
    input.oldFile?.lang ?? null,
    input.newFile?.name ?? null,
    input.newFile?.lang ?? null
  ]
}

// Compact keys never decide equality: cache hits and pending joins compare the raw inputs.
export function getComparisonRequestKey(input: ComparisonInput): string {
  return JSON.stringify([
    COMPARISON_POLICY_VERSION,
    input.output,
    getDiskBaselineSignature(input.originalContent),
    getDiskBaselineSignature(input.modifiedContent),
    input.language,
    input.showWhitespace,
    input.originalVersion,
    input.modifiedVersion,
    input.originalIdentity ?? null,
    input.modifiedIdentity ?? null,
    sourceIdentity(input)
  ])
}

export function inputsMatch(a: ComparisonInput, b: ComparisonInput): boolean {
  return (
    a.output === b.output &&
    a.originalContent === b.originalContent &&
    a.modifiedContent === b.modifiedContent &&
    a.language === b.language &&
    a.showWhitespace === b.showWhitespace &&
    a.originalVersion === b.originalVersion &&
    a.modifiedVersion === b.modifiedVersion &&
    a.originalIdentity === b.originalIdentity &&
    a.modifiedIdentity === b.modifiedIdentity &&
    (a.output !== 'pierre' ||
      (b.output === 'pierre' &&
        a.oldFile?.name === b.oldFile?.name &&
        a.oldFile?.contents === b.oldFile?.contents &&
        a.oldFile?.lang === b.oldFile?.lang &&
        a.newFile?.name === b.newFile?.name &&
        a.newFile?.contents === b.newFile?.contents &&
        a.newFile?.lang === b.newFile?.lang))
  )
}
