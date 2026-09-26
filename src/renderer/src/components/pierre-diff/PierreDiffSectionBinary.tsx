import { lazyWithRetry as lazy } from '@/lib/lazy-with-retry'
import { translate } from '@/i18n/i18n'
import type { GitDiffResult } from '../../../../shared/git-diff-compare-types'

const ImageDiffViewer = lazy(() => import('../editor/ImageDiffViewer'))

export function PierreDiffSectionBinary({
  diffResult,
  filePath,
  sideBySide,
  isBranchMode
}: {
  diffResult: Extract<GitDiffResult, { kind: 'binary' }>
  filePath: string
  sideBySide: boolean
  isBranchMode: boolean
}): React.JSX.Element {
  if (diffResult.isImage) {
    return (
      <ImageDiffViewer
        originalContent={diffResult.originalContent}
        modifiedContent={diffResult.modifiedContent}
        filePath={filePath}
        mimeType={diffResult.mimeType}
        sideBySide={sideBySide}
        layout="intrinsic"
      />
    )
  }
  return (
    <div className="flex items-center justify-center px-6 py-8 text-center">
      <div className="space-y-2">
        <div className="text-sm font-medium text-foreground">
          {translate(
            'auto.components.pierre.diff.PierreDiffSection.fe1a0d0906',
            'Binary file changed'
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          {isBranchMode
            ? translate(
                'auto.components.pierre.diff.PierreDiffSection.1c569d7a56',
                'Text diff is unavailable for this file in branch compare.'
              )
            : translate(
                'auto.components.pierre.diff.PierreDiffSection.d66e68d349',
                'Text diff is unavailable for this file.'
              )}
        </div>
      </div>
    </div>
  )
}
