import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { EditProvider, Virtualizer } from '@pierre/diffs/react'
import type { FileDiff as NativeFileDiff, FileDiffOptions } from '@pierre/diffs'
import { usePierreDiffMetadata } from './use-pierre-diff-metadata'
import { useEditablePierreFileDiff } from './use-editable-pierre-file-diff'
import { useAppStore } from '@/store'
import { selectWorktreeDiffComments } from '@/store/worktree-diff-comments-selector'
import { isDiffComment } from '@/lib/diff-comment-compat'
import { scrollTopCache, setWithLRU } from '@/lib/scroll-cache'
import type { DiffComment } from '../../../../shared/diff-comment-types'
import type { WorkingDocumentId } from '@/store/slices/editor/working-document'
import { translate } from '@/i18n/i18n'
import { LargeDiffFallback } from '../editor/LargeDiffFallback'
import {
  getLargeDiffRenderLimit,
  type LargeDiffRenderLimit
} from '../editor/large-diff-render-limit'
import { buildPierreDiffFileInput } from './pierre-diff-file-input'
import { EditorFileLoadErrorView } from '../editor/EditorFileLoadErrorView'
import { PierreDiffProvider } from './pierre-diff-worker-pool'
import type { PierreDiffFileSource } from './pierre-diff-file-input'
import {
  PIERRE_EDITOR_SURFACE_UNSAFE_CSS,
  usePierreDiffStyleVars,
  usePierreDiffThemeType,
  usePierreSyntaxTheme
} from './pierre-diff-theme'
import {
  buildPierreDiffAnnotations,
  PierreDiffCommentAnnotation,
  type PierreDiffAnnotationData,
  type PierreDiffDraft
} from './pierre-diff-comment-annotations'
import { usePierreWorkingDocumentEditor } from './use-pierre-working-document-editor'
import { PierreFileDiffNavigation } from './PierreFileDiffNavigation'
import { PierreEditableFileDiff } from './PierreEditableFileDiff'
export type PierreFileDiffProps = {
  /** Stable per-tab key for scroll restoration. */
  scrollKey: string
  originalContent: string
  modifiedContent: string
  originalReadState?: PierreDiffFileSource['originalReadState']
  modifiedReadState?: PierreDiffFileSource['modifiedReadState']
  language: string
  relativePath: string
  oldRelativePath?: string
  sideBySide: boolean
  worktreeId?: string
  largeDiffRenderLimit?: LargeDiffRenderLimit
  /** Rendered into the file header's metadata slot (e.g. an "Edit file" action). */
  headerActions?: React.ReactNode
  /** Shared working document enables Monaco editing inside the Pierre layout. */
  workingDocumentId?: WorkingDocumentId
  onSave?: (content: string) => Promise<boolean>
}

export default function PierreFileDiff({
  scrollKey,
  originalContent,
  modifiedContent,
  originalReadState,
  modifiedReadState,
  relativePath,
  oldRelativePath,
  language,
  sideBySide,
  worktreeId,
  largeDiffRenderLimit,
  headerActions,
  workingDocumentId,
  onSave
}: PierreFileDiffProps): React.JSX.Element {
  const diffWordWrap = useAppStore((s) => s.settings?.diffWordWrap)
  const addDiffComment = useAppStore((s) => s.addDiffComment)
  const deleteDiffComment = useAppStore((s) => s.deleteDiffComment)
  const updateDiffComment = useAppStore((s) => s.updateDiffComment)
  const scrollToDiffCommentId = useAppStore((s) => s.scrollToDiffCommentId)
  const setScrollToDiffCommentId = useAppStore((s) => s.setScrollToDiffCommentId)
  const themeType = usePierreDiffThemeType()
  const syntaxTheme = usePierreSyntaxTheme()
  const styleVars = usePierreDiffStyleVars()
  const showWhitespace = useAppStore((s) => s.settings?.diffShowWhitespace === true)
  const allDiffComments = useAppStore((s): DiffComment[] | undefined =>
    selectWorktreeDiffComments(s, worktreeId)
  )
  const diffComments = useMemo(
    () => (allDiffComments ?? []).filter((c) => c.filePath === relativePath && isDiffComment(c)),
    [allDiffComments, relativePath]
  )
  const workingDocument = useAppStore((state) =>
    workingDocumentId ? state.workingDocuments[workingDocumentId] : undefined
  )

  const [draft, setDraft] = useState<PierreDiffDraft | null>(null)
  const { edit, editorOptions, createEditor } = usePierreWorkingDocumentEditor({
    workingDocumentId
  })
  const containerRef = useRef<HTMLDivElement | null>(null)
  const nativeFileDiffRef = useRef<NativeFileDiff<PierreDiffAnnotationData> | null>(null)
  const renderLimit = useMemo(
    () => largeDiffRenderLimit ?? getLargeDiffRenderLimit({ originalContent, modifiedContent }),
    [largeDiffRenderLimit, originalContent, modifiedContent]
  )

  const files = useMemo(
    () =>
      buildPierreDiffFileInput({
        originalContent,
        modifiedContent,
        originalReadState,
        modifiedReadState,
        relativePath,
        oldRelativePath,
        cacheScope: scrollKey
      }),
    [
      originalContent,
      modifiedContent,
      originalReadState,
      modifiedReadState,
      relativePath,
      oldRelativePath,
      scrollKey
    ]
  )

  const canComment = Boolean(worktreeId)
  const options = useMemo(
    (): FileDiffOptions<PierreDiffAnnotationData> => ({
      diffStyle: sideBySide ? 'split' : 'unified',
      themeType,
      theme: syntaxTheme,
      unsafeCSS: PIERRE_EDITOR_SURFACE_UNSAFE_CSS,
      overflow: diffWordWrap === true ? 'wrap' : 'scroll',
      lineDiffType: showWhitespace ? 'word-alt' : 'none',
      stickyHeader: true,
      // Why: click handling lives on the renderGutterUtility slot node — the
      // library forbids combining renderGutterUtility with onGutterUtilityClick.
      enableGutterUtility: canComment,
      onPostRender: (_node, nativeFileDiff) => {
        nativeFileDiffRef.current = nativeFileDiff
      }
    }),
    [sideBySide, themeType, syntaxTheme, diffWordWrap, canComment, showWhitespace]
  )

  const lineAnnotations = useMemo(
    () => buildPierreDiffAnnotations(canComment ? diffComments : [], draft),
    [canComment, diffComments, draft]
  )

  const handleSubmitDraft = useCallback(
    async (pendingDraft: PierreDiffDraft, body: string): Promise<void> => {
      if (!worktreeId) {
        return
      }
      const result = await addDiffComment({
        worktreeId,
        filePath: relativePath,
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
    [worktreeId, relativePath, addDiffComment]
  )

  // Why: annotations are slotted light-DOM children, so pending comment scrolls
  // resolve with a plain querySelector instead of Monaco view-zone bookkeeping.
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

  const scrollCacheKey = `pierre-diff:${scrollKey}`
  useLayoutEffect(() => {
    // Why: the Virtualizer's root div is the scroll container — our ref sits
    // on its parent, so restore/save target the first child element.
    const scroller = containerRef.current?.firstElementChild
    if (!(scroller instanceof HTMLElement)) {
      return
    }
    scroller.scrollTop = scrollTopCache.get(scrollCacheKey) ?? 0
    return () => {
      setWithLRU(scrollTopCache, scrollCacheKey, scroller.scrollTop)
    }
  }, [scrollCacheKey])

  // Why: hook order — comparison still needs to settle before the fallback
  // branch below returns early.
  const { fileDiff, error, generation, retry } = usePierreDiffMetadata(
    files.oldFile,
    files.newFile,
    {
      disabled: renderLimit.limited,
      language,
      showWhitespace,
      retainPreviousWhilePending: workingDocumentId !== undefined,
      workingDocumentId
    }
  )
  const editableFileDiff = useEditablePierreFileDiff(fileDiff, options, edit, generation)

  if (renderLimit.limited) {
    return (
      <LargeDiffFallback
        filePath={relativePath}
        renderLimit={renderLimit}
        action={
          workingDocument?.isDirty && onSave
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
    )
  }
  if (error) {
    return <EditorFileLoadErrorView message={error} onRetry={retry} />
  }
  if (!fileDiff) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">…</div>
    )
  }

  return (
    <PierreDiffProvider>
      <EditProvider createEditor={createEditor}>
        <div
          ref={containerRef}
          data-testid="pierre-file-diff"
          className="h-full min-h-0 bg-[var(--editor-surface)]"
          style={styleVars}
        >
          {/* Why: FileDiff only windows its DOM inside a Virtualizer scroll container —
            without it a 60k-line diff builds the full DOM and freezes the renderer. */}
          <Virtualizer className="h-full min-h-0 overflow-auto scrollbar-editor">
            <PierreEditableFileDiff
              key={workingDocumentId}
              workingDocumentId={workingDocumentId}
              onSave={onSave}
              fileDiff={editableFileDiff.fileDiff ?? fileDiff}
              options={editableFileDiff.options}
              editorOptions={editorOptions}
              edit={edit}
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
              renderHeaderMetadata={headerActions ? () => headerActions : undefined}
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
            <PierreFileDiffNavigation
              nativeFileDiffRef={nativeFileDiffRef}
              shortcutTargetRef={containerRef}
              fileDiff={editableFileDiff.fileDiff ?? fileDiff}
            />
          </Virtualizer>
        </div>
      </EditProvider>
    </PierreDiffProvider>
  )
}
