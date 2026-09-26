import { useMemo, useState } from 'react'
import { FileDiff, type FileDiffProps } from '@pierre/diffs/react'
import type { FileDiff as NativeFileDiff } from '@pierre/diffs'
import type { WorkingDocumentId } from '@/store/slices/editor/working-document'
import type { PierreDiffAnnotationData } from './pierre-diff-comment-annotations'
import { PierreMonacoEditor } from './PierreMonacoEditor'

type Attachment = {
  host: HTMLElement
  nativeFileDiff: NativeFileDiff<PierreDiffAnnotationData>
}

type PierreEditableFileDiffProps = FileDiffProps<PierreDiffAnnotationData> & {
  workingDocumentId?: WorkingDocumentId
  onSave?: (content: string) => Promise<boolean>
}

export function PierreEditableFileDiff({
  workingDocumentId,
  onSave,
  options,
  ...props
}: PierreEditableFileDiffProps): React.JSX.Element {
  const [attachment, setAttachment] = useState<Attachment | null>(null)
  const attachedOptions = useMemo(
    () => ({
      ...options,
      onPostRender: ((host, nativeFileDiff, phase) => {
        options?.onPostRender?.(host, nativeFileDiff, phase)
        setAttachment((current) => {
          if (phase === 'unmount') {
            return null
          }
          return current?.host === host && current.nativeFileDiff === nativeFileDiff
            ? current
            : { host, nativeFileDiff }
        })
      }) satisfies NonNullable<NonNullable<typeof options>['onPostRender']>
    }),
    [options]
  )

  if (!workingDocumentId || !props.edit) {
    return <FileDiff {...props} options={options} />
  }
  return (
    <div className="relative">
      <FileDiff {...props} options={attachedOptions} />
      {attachment && (
        <PierreMonacoEditor
          key={workingDocumentId}
          workingDocumentId={workingDocumentId}
          host={attachment.host}
          nativeFileDiff={attachment.nativeFileDiff}
          onSave={onSave}
        />
      )}
    </div>
  )
}
