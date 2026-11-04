import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import {
  describeSharedDropFailureReason,
  describeSharedDropSkipReason
} from '@/lib/drop-skip-reason-copy'
import type { ImportItemResult } from '../../../../shared/filesystem-import-result-types'

/** Report failed or wholly skipped explorer imports (drops and pastes); full success stays quiet. */
export function toastFileExplorerImportProblems(results: readonly ImportItemResult[]): void {
  const imported = results.filter((r) => r.status === 'imported')
  const skipped = results.filter((r) => r.status === 'skipped')
  const failed = results.filter((r) => r.status === 'failed')

  if (failed.length > 0) {
    const noun = failed.length === 1 ? 'file' : 'files'
    toast.error(
      translate(
        'auto.components.right.sidebar.useFileExplorerImport.132fd0e1e9',
        'Failed to import {{value0}} {{value1}}.',
        { value0: failed.length, value1: noun }
      ),
      { description: describeSharedDropFailureReason(failed) }
    )
  } else if (skipped.length > 0 && imported.length === 0) {
    const noun = skipped.length === 1 ? 'file' : 'files'
    toast.error(
      translate(
        'auto.components.right.sidebar.useFileExplorerImport.25919b2050',
        'Skipped {{value0}} {{value1}}.',
        { value0: skipped.length, value1: noun }
      ),
      { description: describeSharedDropSkipReason(skipped) }
    )
  }
}
