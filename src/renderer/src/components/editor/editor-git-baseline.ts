import { getDiskBaselineSignature } from './diff-content-signature'
import type { DiffContent } from './editor-panel-content-types'

export type EditorGitBaseline = {
  content: string
  identity: string
  version: string
}

export function getTrustedEditorGitBaseline(
  diff: DiffContent | undefined,
  scope: string | null
): EditorGitBaseline | null {
  if (
    scope === null ||
    diff?.kind !== 'text' ||
    diff.gitBaselineScope !== scope ||
    diff.isStale ||
    diff.largeDiffRenderLimit?.limited ||
    (diff.originalReadState !== 'present' && diff.originalReadState !== 'absent')
  ) {
    return null
  }

  return {
    content: diff.originalContent,
    identity: `git-head:${scope}`,
    version: getDiskBaselineSignature(diff.originalContent)
  }
}
