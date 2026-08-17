import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Plus, RefreshCw } from 'lucide-react'
import { FileDiff } from '@pierre/diffs/react'
import type { FileDiffOptions } from '@pierre/diffs'
import { usePierreDiffMetadata } from './use-pierre-diff-metadata'
import { lazyWithRetry as lazy } from '@/lib/lazy-with-retry'
import { useAppStore } from '@/store'
import { selectWorktreeDiffComments } from '@/store/worktree-diff-comments-selector'
import { isDiffComment } from '@/lib/diff-comment-compat'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { DiffComment } from '../../../../shared/diff-comment-types'
import type { DiffSection } from '../editor/diff-section-types'
import { DiffSectionHeader } from '../editor/DiffSectionHeader'
import { LargeDiffFallback } from '../editor/LargeDiffFallback'
import { buildPierreDiffFileInput } from './pierre-diff-file-input'
import { usePierreDiffStyleVars, usePierreDiffThemeType } from './pierre-diff-theme'
import {
  buildPierreDiffAnnotations,
  PierreDiffCommentAnnotation,
  type PierreDiffAnnotationData,
  type PierreDiffDraft
} from './pierre-diff-comment-annotations'

const ImageDiffViewer = lazy(() => import('../editor/ImageDiffViewer'))

export type PierreDiffSectionProps = {
  section: DiffSection
  index: number
  isBranchMode: boolean
  sideBySide: boolean
  worktreeId?: string
  loadSection: (index: number) => void
  retrySection: (index: number) => void
  toggleSection: (index: number) => void
  openSection: (index: number) => void
  openSectionTitle: string
  onOpenPreview?: (section: DiffSection, index: number) => void
  renderHeaderTrailingContent?: (section: DiffSection, index: number) => React.ReactNode
}

/** Combined-diff section rendered by @pierre/diffs; rows are read-only and intrinsic-height. */
export function PierreDiffSection({
  section,
  index,
  isBranchMode,
  sideBySide,
  worktreeId,
  loadSection,
  retrySection,
  toggleSection,
  openSection,
  openSectionTitle,
  onOpenPreview,
  renderHeaderTrailingContent
}: PierreDiffSectionProps): React.JSX.Element {
  const diffWordWrap = useAppStore((s) => s.settings?.diffWordWrap)
  const addDiffComment = useAppStore((s) => s.addDiffComment)
  const deleteDiffComment = useAppStore((s) => s.deleteDiffComment)
  const updateDiffComment = useAppStore((s) => s.updateDiffComment)
  const scrollToDiffCommentId = useAppStore((s) => s.scrollToDiffCommentId)
  const setScrollToDiffCommentId = useAppStore((s) => s.setScrollToDiffCommentId)
  const themeType = usePierreDiffThemeType()
  const styleVars = usePierreDiffStyleVars()
  // Why: subscribe to the reference-stable worktree array and filter in a memo
  // so unrelated store updates don't re-render every section.
  const allDiffComments = useAppStore((s): DiffComment[] | undefined =>
    selectWorktreeDiffComments(s, worktreeId)
  )
  const diffComments = useMemo(
    () => (allDiffComments ?? []).filter((c) => c.filePath === section.path && isDiffComment(c)),
    [allDiffComments, section.path]
  )

  const [draft, setDraft] = useState<PierreDiffDraft | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    loadSection(index)
  }, [index, loadSection])

  const files = useMemo(
    () =>
      buildPierreDiffFileInput({
        originalContent: section.originalContent,
        modifiedContent: section.modifiedContent,
        relativePath: section.path,
        oldRelativePath: section.oldPath,
        cacheScope: `${section.key}:${section.contentGeneration ?? 0}`
      }),
    [
      section.originalContent,
      section.modifiedContent,
      section.path,
      section.oldPath,
      section.key,
      section.contentGeneration
    ]
  )

  const canComment = Boolean(worktreeId)
  const options = useMemo(
    (): FileDiffOptions<PierreDiffAnnotationData> => ({
      diffStyle: sideBySide ? 'split' : 'unified',
      themeType,
      overflow: diffWordWrap === true ? 'wrap' : 'scroll',
      // Why: the Orca DiffSectionHeader above is the sticky per-file header.
      disableFileHeader: true,
      // Why: click handling lives on the renderGutterUtility slot node — the
      // library forbids combining renderGutterUtility with onGutterUtilityClick.
      enableGutterUtility: canComment
    }),
    [sideBySide, themeType, diffWordWrap, canComment]
  )

  const lineAnnotations = useMemo(
    () => buildPierreDiffAnnotations(canComment ? diffComments : [], draft),
    [canComment, diffComments, draft]
  )

  // Why: large diffs parse in a worker so scrolling sections into view never
  // blocks the renderer; the body waits until metadata arrives.
  const fileDiff = usePierreDiffMetadata(
    files.oldFile,
    files.newFile,
    section.loading ||
      section.error != null ||
      section.diffResult?.kind === 'binary' ||
      section.largeDiffRenderLimit?.limited === true ||
      section.collapsed === true
  )

  const handleSubmitDraft = useCallback(
    async (pendingDraft: PierreDiffDraft, body: string): Promise<void> => {
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
    [worktreeId, section.path, addDiffComment]
  )

  // Why: annotations are slotted light-DOM children, so a pending comment
  // scroll resolves with a plain querySelector once it targets this section.
  useEffect(() => {
    if (!scrollToDiffCommentId || !worktreeId) {
      return
    }
    if (!diffComments.some((c) => c.id === scrollToDiffCommentId)) {
      return
    }
    const frame = requestAnimationFrame(() => {
      containerRef.current
        ?.querySelector(`[data-diff-comment-id="${CSS.escape(scrollToDiffCommentId)}"]`)
        ?.scrollIntoView({ block: 'center' })
      setScrollToDiffCommentId(null)
    })
    return () => cancelAnimationFrame(frame)
  }, [scrollToDiffCommentId, diffComments, worktreeId, setScrollToDiffCommentId])

  return (
    <div className="border-b border-border">
      <DiffSectionHeader
        path={section.path}
        dirty={section.dirty}
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
        (section.loading ? (
          <div className="flex h-10 items-center gap-2 bg-muted/10 px-3 text-[11px] text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
            <span>
              {translate(
                'auto.components.pierre.diff.PierreDiffSection.8954354a5b',
                'Loading diff...'
              )}
            </span>
          </div>
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
          section.diffResult.isImage ? (
            <ImageDiffViewer
              originalContent={section.diffResult.originalContent}
              modifiedContent={section.diffResult.modifiedContent}
              filePath={section.path}
              mimeType={section.diffResult.mimeType}
              sideBySide={sideBySide}
              layout="intrinsic"
            />
          ) : (
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
        ) : section.largeDiffRenderLimit?.limited ? (
          <LargeDiffFallback filePath={section.path} renderLimit={section.largeDiffRenderLimit} />
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
          <div ref={containerRef} className="bg-[var(--editor-surface)]" style={styleVars}>
            <FileDiff<PierreDiffAnnotationData>
              fileDiff={fileDiff}
              options={options}
              lineAnnotations={lineAnnotations}
              renderAnnotation={(annotation) =>
                annotation.metadata ? (
                  <PierreDiffCommentAnnotation
                    data={annotation.metadata}
                    onDeleteComment={
                      worktreeId ? (id) => void deleteDiffComment(worktreeId, id) : undefined
                    }
                    onUpdateComment={
                      worktreeId ? (id, body) => updateDiffComment(worktreeId, id, body) : undefined
                    }
                    onCancelDraft={() => setDraft(null)}
                    onSubmitDraft={handleSubmitDraft}
                  />
                ) : null
              }
              renderGutterUtility={
                canComment
                  ? (getHoveredLine) => (
                      <button
                        type="button"
                        className="flex size-4 cursor-pointer items-center justify-center rounded-sm bg-primary text-primary-foreground shadow-sm"
                        onClick={() => {
                          const hovered = getHoveredLine()
                          // Why: notes anchor to the modified side only (DiffComment.side is always 'modified').
                          if (!hovered || hovered.side === 'deletions') {
                            return
                          }
                          setDraft({ lineNumber: hovered.lineNumber })
                        }}
                      >
                        <Plus className="size-3" />
                      </button>
                    )
                  : undefined
              }
            />
          </div>
        ))}
    </div>
  )
}
