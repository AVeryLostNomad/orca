import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'
import type { FileDiffOptions } from '@pierre/diffs'
import { usePierreDiffMetadata } from './use-pierre-diff-metadata'
import { detectLanguage } from '@/lib/language-detect'
import { EditorFileLoadErrorView } from '../editor/EditorFileLoadErrorView'
import { useAppStore } from '@/store'
import { selectWorktreeDiffComments } from '@/store/worktree-diff-comments-selector'
import { isDiffComment } from '@/lib/diff-comment-compat'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { DiffComment } from '../../../../shared/diff-comment-types'
import type { DecoratedDiffComment } from '../diff-comments/decorated-diff-comment'
import type { DiffSection } from '../editor/diff-section-types'
import { DiffSectionHeader } from '../editor/DiffSectionHeader'
import { LargeDiffFallback } from '../editor/LargeDiffFallback'
import { getLargeDiffRenderLimit } from '../editor/large-diff-render-limit'
import { LargeDiffLoadPrompt } from '../editor/LargeDiffLoadPrompt'
import { isCombinedDiffSizeUnknown } from '../editor/combined-diff-on-demand-load'
import { PierreDiffSectionBinary } from './PierreDiffSectionBinary'
import type { WorkingDocumentId } from '@/store/slices/editor/working-document'
import { loadWorkingDocument } from '../editor/working-document-loader'
import { buildPierreDiffFileInput } from './pierre-diff-file-input'
import {
  PIERRE_EDITOR_SURFACE_UNSAFE_CSS,
  usePierreDiffStyleVars,
  usePierreDiffThemeType,
  usePierreSyntaxTheme
} from './pierre-diff-theme'
import {
  buildPierreDiffAnnotations,
  type PierreDiffAnnotationData,
  type PierreDiffDraft
} from './pierre-diff-comment-annotations'
import { usePierreWorkingDocumentEditor } from './use-pierre-working-document-editor'
import { PierreDiffSectionFile } from './PierreDiffSectionFile'
import { useEditablePierreFileDiff } from './use-editable-pierre-file-diff'
export type PierreDiffSectionProps = {
  section: DiffSection
  index: number
  isBranchMode: boolean
  sideBySide: boolean
  worktreeId?: string
  loadSection: (index: number) => void
  loadDeferredSection?: (index: number) => void
  retrySection: (index: number) => void
  toggleSection: (index: number) => void
  openSection: (index: number) => void
  openSectionTitle: string
  onOpenPreview?: (section: DiffSection, index: number) => void
  renderHeaderTrailingContent?: (section: DiffSection, index: number) => React.ReactNode
  inlineComments?: readonly DecoratedDiffComment[]
  onAddLineComment?: (
    section: DiffSection,
    args: { lineNumber: number; startLine?: number; body: string }
  ) => Promise<boolean>
  addLineCommentLabel?: string
  getCommentableLineNumbers?: (section: DiffSection) => readonly number[] | undefined
  workingDocumentId?: WorkingDocumentId
  onSave?: (content: string) => Promise<boolean>
}
/** Combined-diff section rendered by @pierre/diffs. */
export function PierreDiffSection({
  section,
  index,
  isBranchMode,
  sideBySide,
  worktreeId,
  loadSection,
  loadDeferredSection,
  retrySection,
  toggleSection,
  openSection,
  openSectionTitle,
  onOpenPreview,
  renderHeaderTrailingContent,
  inlineComments,
  onAddLineComment,
  addLineCommentLabel,
  getCommentableLineNumbers,
  workingDocumentId,
  onSave
}: PierreDiffSectionProps): React.JSX.Element {
  const diffWordWrap = useAppStore((s) => s.settings?.diffWordWrap)
  const showWhitespace = useAppStore((s) => s.settings?.diffShowWhitespace === true)
  const addDiffComment = useAppStore((s) => s.addDiffComment)
  const deleteDiffComment = useAppStore((s) => s.deleteDiffComment)
  const updateDiffComment = useAppStore((s) => s.updateDiffComment)
  const scrollToDiffCommentId = useAppStore((s) => s.scrollToDiffCommentId)
  const setScrollToDiffCommentId = useAppStore((s) => s.setScrollToDiffCommentId)
  const themeType = usePierreDiffThemeType()
  const syntaxTheme = usePierreSyntaxTheme()
  const styleVars = usePierreDiffStyleVars()
  const allDiffComments = useAppStore((s): DiffComment[] | undefined =>
    selectWorktreeDiffComments(s, worktreeId)
  )
  const diffComments = useMemo(
    () => (allDiffComments ?? []).filter((c) => c.filePath === section.path && isDiffComment(c)),
    [allDiffComments, section.path]
  )
  const workingDocument = useAppStore((state) =>
    workingDocumentId ? state.workingDocuments[workingDocumentId] : undefined
  )
  const editableWorkingDocument =
    workingDocument?.loadState === 'ready' &&
    workingDocument.writable &&
    workingDocument.content !== undefined
      ? workingDocument
      : undefined
  const isEditable = editableWorkingDocument !== undefined
  const modifiedContent = editableWorkingDocument?.content ?? section.modifiedContent
  const renderLimit = useMemo(
    () =>
      section.largeDiffRenderLimit?.limited
        ? section.largeDiffRenderLimit
        : getLargeDiffRenderLimit({
            originalContent: section.originalContent,
            modifiedContent
          }),
    [modifiedContent, section.originalContent, section.largeDiffRenderLimit]
  )
  const { edit, editorOptions, createEditor } = usePierreWorkingDocumentEditor({
    workingDocumentId: isEditable ? workingDocumentId : undefined
  })
  const [draft, setDraft] = useState<PierreDiffDraft | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const language = detectLanguage(section.path)
  useEffect(() => {
    loadSection(index)
  }, [index, loadSection])
  const files = useMemo(
    () =>
      buildPierreDiffFileInput({
        originalContent: section.originalContent,
        modifiedContent,
        originalReadState: section.diffResult?.originalReadState,
        modifiedReadState: section.diffResult?.modifiedReadState,
        relativePath: section.path,
        oldRelativePath: section.oldPath,
        cacheScope: `${section.key}:${section.contentGeneration ?? 0}`
      }),
    [
      modifiedContent,
      section.contentGeneration,
      section.diffResult?.modifiedReadState,
      section.diffResult?.originalReadState,
      section.key,
      section.oldPath,
      section.originalContent,
      section.path
    ]
  )
  const comments = inlineComments ?? diffComments
  const canComment = Boolean(worktreeId || onAddLineComment)
  const options = useMemo(
    (): FileDiffOptions<PierreDiffAnnotationData> => ({
      diffStyle: sideBySide ? 'split' : 'unified',
      themeType,
      theme: syntaxTheme,
      unsafeCSS: PIERRE_EDITOR_SURFACE_UNSAFE_CSS,
      overflow: diffWordWrap === true ? 'wrap' : 'scroll',
      lineDiffType: showWhitespace ? 'word-alt' : 'none',
      disableFileHeader: true,
      enableGutterUtility: canComment
    }),
    [sideBySide, themeType, syntaxTheme, diffWordWrap, canComment, showWhitespace]
  )
  const lineAnnotations = useMemo(
    () => buildPierreDiffAnnotations(canComment ? comments : [], draft),
    [canComment, comments, draft]
  )
  const commentableLineNumbers = getCommentableLineNumbers?.(section)
  const {
    fileDiff,
    error: comparisonError,
    generation,
    retry: retryComparison
  } = usePierreDiffMetadata(files.oldFile, files.newFile, {
    disabled:
      section.loading ||
      section.loadOnDemand === true ||
      section.error != null ||
      section.diffResult?.kind === 'binary' ||
      renderLimit.limited ||
      section.collapsed === true,
    language,
    showWhitespace,
    retainPreviousWhilePending: isEditable,
    workingDocumentId
  })
  const editableFileDiff = useEditablePierreFileDiff(fileDiff, options, edit, generation)
  const handleSubmitDraft = useCallback(
    async (pendingDraft: PierreDiffDraft, body: string): Promise<void> => {
      if (onAddLineComment) {
        if (
          commentableLineNumbers !== undefined &&
          !commentableLineNumbers.includes(pendingDraft.lineNumber)
        ) {
          return
        }
        if (await onAddLineComment(section, { ...pendingDraft, body })) {
          setDraft(null)
        }
        return
      }
      if (!worktreeId) {
        return
      }
      const result = await addDiffComment({
        worktreeId,
        filePath: section.path,
        source: 'diff',
        startLine: pendingDraft.startLine,
        lineNumber: pendingDraft.lineNumber,
        body,
        side: 'modified'
      })
      if (result) {
        setDraft(null)
      } else {
        console.error('Failed to add diff comment — draft preserved')
      }
    },
    [addDiffComment, commentableLineNumbers, onAddLineComment, section, worktreeId]
  )
  useEffect(() => {
    if (!scrollToDiffCommentId || !worktreeId) {
      return
    }
    if (!comments.some((c) => c.id === scrollToDiffCommentId)) {
      return
    }
    const frame = requestAnimationFrame(() => {
      containerRef.current
        ?.querySelector(`[data-diff-comment-id="${CSS.escape(scrollToDiffCommentId)}"]`)
        ?.scrollIntoView({ block: 'center' })
      setScrollToDiffCommentId(null)
    })
    return () => cancelAnimationFrame(frame)
  }, [scrollToDiffCommentId, comments, worktreeId, setScrollToDiffCommentId])
  const workingDocumentError =
    workingDocument?.loadState === 'error'
      ? (workingDocument.loadError ?? 'Unable to load the working file.')
      : undefined
  return (
    <div className="border-b border-border">
      <DiffSectionHeader
        path={section.path}
        dirty={workingDocument?.isDirty ?? false}
        collapsed={section.collapsed}
        added={section.added ?? 0}
        removed={section.removed ?? 0}
        onToggle={() => toggleSection(index)}
        onOpenSection={(event) => {
          event.stopPropagation()
          openSection(index)
        }}
        openSectionTitle={openSectionTitle}
        onOpenPreview={onOpenPreview ? () => onOpenPreview(section, index) : undefined}
        trailingContent={renderHeaderTrailingContent?.(section, index)}
      />
      {!section.collapsed &&
        (section.loadOnDemand && loadDeferredSection ? (
          <LargeDiffLoadPrompt
            sizeUnknown={isCombinedDiffSizeUnknown(section)}
            onLoad={() => loadDeferredSection(index)}
          />
        ) : section.loading ? (
          <div className="flex h-10 items-center gap-2 bg-muted/10 px-3 text-[11px] text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
            <span>
              {translate(
                'auto.components.pierre.diff.PierreDiffSection.8954354a5b',
                'Loading diff...'
              )}
            </span>
          </div>
        ) : workingDocumentError ? (
          <EditorFileLoadErrorView
            message={workingDocumentError}
            onRetry={() => {
              if (workingDocumentId) {
                void loadWorkingDocument(workingDocumentId, { force: true }).catch(() => undefined)
              }
            }}
          />
        ) : section.error ? (
          <div className="flex h-10 items-center justify-between gap-3 bg-muted/10 px-3 text-[11px] text-muted-foreground">
            <div className="flex min-w-0 items-center gap-2">
              <AlertCircle className="size-3.5 shrink-0 text-destructive" />
              <span className="truncate">{section.error}</span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="h-6 shrink-0 px-2 text-[11px]"
              onClick={(event) => {
                event.stopPropagation()
                retrySection(index)
              }}
            >
              <RefreshCw className="size-3" />
              {translate('auto.components.pierre.diff.PierreDiffSection.1f5066e25c', 'Retry')}
            </Button>
          </div>
        ) : section.diffResult?.kind === 'binary' ? (
          <PierreDiffSectionBinary
            diffResult={section.diffResult}
            filePath={section.path}
            sideBySide={sideBySide}
            isBranchMode={isBranchMode}
          />
        ) : renderLimit.limited ? (
          <LargeDiffFallback
            filePath={section.path}
            renderLimit={renderLimit}
            action={
              isEditable && editableWorkingDocument.isDirty && onSave
                ? {
                    label: translate('auto.components.editor.DiffSectionBody.b5675b0694', 'Save'),
                    description: translate(
                      'auto.components.editor.DiffSectionBody.593f2193f6',
                      'This draft crossed the safe display limit, but it can still be saved.'
                    ),
                    onClick: () => void onSave(modifiedContent)
                  }
                : undefined
            }
          />
        ) : comparisonError ? (
          <EditorFileLoadErrorView message={comparisonError} onRetry={retryComparison} />
        ) : !fileDiff ? (
          <div className="flex h-10 items-center gap-2 bg-muted/10 px-3 text-[11px] text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
            <span>
              {translate(
                'auto.components.pierre.diff.PierreDiffSection.8954354a5b',
                'Loading diff...'
              )}
            </span>
          </div>
        ) : (
          <div
            ref={containerRef}
            data-testid="pierre-diff-section"
            className="bg-[var(--editor-surface)]"
            style={styleVars}
          >
            <PierreDiffSectionFile
              createEditor={createEditor}
              workingDocumentId={workingDocumentId}
              onSave={onSave}
              fileDiff={editableFileDiff.fileDiff ?? fileDiff}
              options={editableFileDiff.options}
              editorOptions={editorOptions}
              edit={edit}
              lineAnnotations={lineAnnotations}
              canComment={canComment}
              addLineCommentLabel={addLineCommentLabel}
              onAddAtLine={(lineNumber) => {
                if (
                  commentableLineNumbers === undefined ||
                  commentableLineNumbers.includes(lineNumber)
                ) {
                  setDraft({ lineNumber })
                }
              }}
              onDeleteComment={
                worktreeId ? (id) => void deleteDiffComment(worktreeId, id) : undefined
              }
              onUpdateComment={
                worktreeId ? (id, body) => updateDiffComment(worktreeId, id, body) : undefined
              }
              onCancelDraft={() => setDraft(null)}
              onSubmitDraft={handleSubmitDraft}
            />
          </div>
        ))}
    </div>
  )
}
