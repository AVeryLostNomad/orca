// Why: Pierre uses this compact content identity for semantic metadata and
// non-editable render cache entries without retaining whole file contents.
export function getDiffContentSignature(content: string): string {
  let hash = 2166136261
  for (let i = 0; i < content.length; i += 1) {
    hash ^= content.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

export { getDiskBaselineSignature } from '../../../../shared/disk-baseline-signature'
