import type React from 'react'
import type { MarkdownDocument } from '../../../../shared/filesystem-entry-types'
import type { WorkingDocumentId } from '@/store/slices/editor/working-document'

export type RichMarkdownEditorProps = {
  fileId: string
  documentId: WorkingDocumentId
  documentRevision: number
  viewStateId: string
  content: string
  filePath: string
  worktreeId: string
  externalSshTargetId?: string
  runtimeEnvironmentId?: string | null
  scrollCacheKey: string
  onContentChange: (content: string) => void
  onSave: (content: string) => void
  onOpenDocLink?: (target: string) => void
  markdownDocuments?: MarkdownDocument[]
  showTableOfContents?: boolean
  onCloseTableOfContents?: () => void
  markdownAnnotationsEnabled?: boolean
  markdownAnnotationFilePath?: string
  markdownSourceLineOffset?: number
  markdownReviewContent?: string
  // Why: front-matter is stripped from the rich editor's content but we still
  // want it visible to the user. It renders between the toolbar and the editor
  // surface so the formatting toolbar stays at the top of the pane.
  headerSlot?: React.ReactNode
}
