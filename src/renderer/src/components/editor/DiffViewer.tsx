import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { DiffEditor, type DiffOnMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { useAppStore } from '@/store'
import { diffViewStateCache, setWithLRU } from '@/lib/scroll-cache'
import { monaco } from '@/lib/monaco-setup'
import { computeDiffEditorFontSize, resolveEditorBaseFontSize } from '@/lib/editor-font-zoom'
import { useMonacoThemeName } from '@/lib/monaco-highlighting/use-monaco-theme-name'
import { useContextualCopySetup } from './useContextualCopySetup'
import { selectWorktreeDiffComments } from '@/store/worktree-diff-comments-selector'
import { useDiffCommentDecorator } from '../diff-comments/useDiffCommentDecorator'
import { DiffCommentPopover } from '../diff-comments/DiffCommentPopover'
import {
  getDiffCommentPopoverLeft,
  getDiffCommentPopoverTop
} from '../diff-comments/diff-comment-popover-position'
import { applyDiffEditorLineNumberOptions } from './diff-editor-line-number-options'
import type { DiffComment } from '../../../../shared/diff-comment-types'
import { isDiffComment } from '@/lib/diff-comment-compat'
import { installEditorSaveShortcut, installMonacoEditorFindShortcut } from './editor-shortcuts'
import { LargeDiffFallback } from './LargeDiffFallback'
import { getLargeDiffRenderLimit } from './large-diff-render-limit'
import { useDiffViewerLargeDiffLifecycle } from './useDiffViewerLargeDiffLifecycle'
import { getDiffViewerLargeDiffSaveAction } from './diff-viewer-large-diff-save-action'
import type { DiffViewerProps } from './diff-viewer-props'
import { buildDiffViewerEditorOptions } from './diff-viewer-editor-options'
import { useDiffEditorRegistration } from './diff-navigation-context'
import { preserveDiffViewStateAcrossModelSwaps } from './diff-model-swap-view-state'
import {
  acquireWorkingDocumentModel,
  attachWorkingDocumentEditor,
  getWorkingDocumentModelUri
} from './working-document-model'
import { flushPendingEditorChange } from './editor-pending-flush'
import { useLspForEditor } from '@/lib/lsp/use-lsp-for-editor'
import { EditorLspStatusChip } from './EditorLspStatusChip'
import { EditorFileLoadErrorView } from './EditorFileLoadErrorView'
import { useDiffComparisonFailure } from './use-diff-comparison-failure'
import { useDiffFirstChangeAutoScroll } from './use-diff-first-change-auto-scroll'

export default function DiffViewer({
  modelKey,
  workingDocumentId,
  originalModelKey,
  modifiedModelKey,
  originalContent,
  modifiedContent,
  language,
  filePath,
  relativePath,
  sideBySide,
  worktreeId,
  onAddLineComment,
  commentableLineNumbers,
  addLineCommentLabel,
  addLineCommentPlaceholder,
  onSave,
  largeDiffRenderLimit,
  largeDiffSaveContentAvailable
}: DiffViewerProps): React.JSX.Element {
  const editable = workingDocumentId !== undefined
  const settings = useAppStore((s) => s.settings)
  const editorFontZoomLevel = useAppStore((s) => s.editorFontZoomLevel)
  const addDiffComment = useAppStore((s) => s.addDiffComment)
  const deleteDiffComment = useAppStore((s) => s.deleteDiffComment)
  const updateDiffComment = useAppStore((s) => s.updateDiffComment)
  const scrollToDiffCommentId = useAppStore((s) => s.scrollToDiffCommentId)
  const setScrollToDiffCommentId = useAppStore((s) => s.setScrollToDiffCommentId)
  // Why: subscribe to the raw array so selector identity only changes when this worktree's comments change; filtering happens below.
  const allDiffComments = useAppStore((s): DiffComment[] | undefined =>
    selectWorktreeDiffComments(s, worktreeId)
  )
  const diffComments = useMemo(
    () => (allDiffComments ?? []).filter((c) => c.filePath === relativePath && isDiffComment(c)),
    [allDiffComments, relativePath]
  )
  const baseFontSize = resolveEditorBaseFontSize(settings)
  const diffEditorFontSize = computeDiffEditorFontSize(baseFontSize, editorFontZoomLevel)
  const monacoThemeName = useMonacoThemeName()

  const diffEditorRef = useRef<editor.IStandaloneDiffEditor | null>(null)
  const { registerDiffEditor, unregisterDiffEditor } = useDiffEditorRegistration()
  const diffBodyRef = useRef<HTMLDivElement | null>(null)
  const lineNumberOptionsSubRef = useRef<{ dispose: () => void } | null>(null)
  const [modifiedEditor, setModifiedEditor] = useState<editor.IStandaloneCodeEditor | null>(null)
  const [originalModel, setOriginalModel] = useState<editor.ITextModel | null>(null)
  const [popover, setPopover] = useState<{
    lineNumber: number
    startLine?: number
    top: number
    left?: number
    lineHeight: number
  } | null>(null)

  const renderLimit = useMemo(
    () => largeDiffRenderLimit ?? getLargeDiffRenderLimit({ originalContent, modifiedContent }),
    [largeDiffRenderLimit, originalContent, modifiedContent]
  )
  const workingModelUri = useMemo(() => {
    if (!workingDocumentId || renderLimit.limited) {
      return undefined
    }
    acquireWorkingDocumentModel(workingDocumentId)
    return getWorkingDocumentModelUri(workingDocumentId)
  }, [workingDocumentId, renderLimit.limited])
  const lspStatus = useLspForEditor({
    mountedEditor: editable ? modifiedEditor : null,
    filePath,
    language,
    worktreeId,
    documentId: workingDocumentId
  })
  const { error: comparisonError, retry: retryComparison } = useDiffComparisonFailure({
    original: originalModel,
    modified: modifiedEditor?.getModel() ?? null,
    showWhitespace: settings?.diffShowWhitespace === true
  })
  useLayoutEffect(() => {
    if (!workingDocumentId || !modifiedEditor) {
      return
    }
    const detach = attachWorkingDocumentEditor(workingDocumentId, modelKey)
    const flush = (): void => flushPendingEditorChange(workingDocumentId, modelKey)
    const focus = modifiedEditor.onDidFocusEditorText(flush)
    if (modifiedEditor.hasTextFocus()) {
      flush()
    }
    return () => {
      focus.dispose()
      detach()
    }
  }, [workingDocumentId, modifiedEditor, modelKey])
  const hasLineCommentAction = Boolean(worktreeId || onAddLineComment)

  // Why: only forward the pending scroll id when this viewer owns the comment, else unrelated viewers race to ack it.
  const pendingScrollForThisViewer = useMemo(() => {
    if (!worktreeId || !scrollToDiffCommentId) {
      return null
    }
    return diffComments.some((c) => c.id === scrollToDiffCommentId) ? scrollToDiffCommentId : null
  }, [scrollToDiffCommentId, diffComments, worktreeId])

  // Why: gate the decorator on a comment target; updateDiffComment is only wired for local diffs (worktreeId present).
  useDiffCommentDecorator({
    editor: hasLineCommentAction ? modifiedEditor : null,
    monacoModelIdentity: modifiedModelKey ?? modelKey,
    filePath: relativePath,
    worktreeId: worktreeId ?? '',
    comments: worktreeId ? diffComments : [],
    commentableLineNumbers,
    addButtonLabel: addLineCommentLabel,
    onAddCommentClick: ({ lineNumber, startLine, top }) =>
      setPopover({
        lineNumber,
        startLine,
        top,
        left: modifiedEditor
          ? (getDiffCommentPopoverLeft(modifiedEditor, diffBodyRef.current) ?? undefined)
          : undefined,
        lineHeight: modifiedEditor?.getOption(monaco.editor.EditorOption.lineHeight) ?? 0
      }),
    onDeleteComment: (id) => {
      if (worktreeId) {
        void deleteDiffComment(worktreeId, id)
      }
    },
    onUpdateComment: worktreeId ? (id, body) => updateDiffComment(worktreeId, id, body) : undefined,
    pendingScrollCommentId: pendingScrollForThisViewer,
    onPendingScrollConsumed: () => setScrollToDiffCommentId(null)
  })

  useEffect(() => {
    if (!modifiedEditor || !popover) {
      return
    }
    const update = (): void => {
      const lineHeight = modifiedEditor.getOption(monaco.editor.EditorOption.lineHeight)
      const top = getDiffCommentPopoverTop(modifiedEditor, popover.lineNumber, lineHeight)
      if (top == null) {
        setPopover(null)
        return
      }
      const left = getDiffCommentPopoverLeft(modifiedEditor, diffBodyRef.current)
      setPopover((prev) =>
        prev ? { ...prev, top, left: left == null ? prev.left : left, lineHeight } : prev
      )
    }
    const scrollSub = modifiedEditor.onDidScrollChange(update)
    const contentSub = modifiedEditor.onDidContentSizeChange(update)
    const layoutSub = modifiedEditor.onDidLayoutChange(update)
    return () => {
      scrollSub.dispose()
      contentSub.dispose()
      layoutSub.dispose()
    }
    // Why: depend on popover.lineNumber (not the whole object) so the effect doesn't re-subscribe on every top update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modifiedEditor, popover?.lineNumber])

  // Why: center the first diff after the decorator's view zones, which would otherwise shift content downward.
  useDiffFirstChangeAutoScroll({
    diffEditorRef,
    modifiedEditor,
    modelKey,
    pendingScrollCommentId: pendingScrollForThisViewer
  })

  const handleEnterLargeDiffFallback = useCallback(() => {
    // Why: on fallback transition, drop stale Monaco refs so decorators/save handlers don't talk to disposed UI.
    lineNumberOptionsSubRef.current?.dispose()
    lineNumberOptionsSubRef.current = null
    // Why: capture before nulling so we unregister the exact instance (identity guard no-ops a stale dispose).
    const fallenBackEditor = diffEditorRef.current
    diffEditorRef.current = null
    if (fallenBackEditor) {
      unregisterDiffEditor(fallenBackEditor)
    }
    setModifiedEditor(null)
    setPopover(null)
  }, [unregisterDiffEditor])

  const handleSubmitComment = async (body: string): Promise<void> => {
    if (!popover) {
      return
    }
    if (onAddLineComment) {
      const ok = await onAddLineComment({
        lineNumber: popover.lineNumber,
        startLine: popover.startLine,
        body
      })
      if (ok) {
        setPopover(null)
      }
      return
    }
    if (!worktreeId) {
      return
    }
    // Why: await persistence — a null result (failed save) keeps the popover open for retry instead of losing the draft.
    const result = await addDiffComment({
      worktreeId,
      filePath: relativePath,
      source: 'diff',
      startLine: popover.startLine,
      lineNumber: popover.lineNumber,
      body,
      side: 'modified'
    })
    if (result) {
      setPopover(null)
    } else {
      console.error('Failed to add diff comment — draft preserved')
    }
  }

  // Keep refs to latest callbacks so the mounted editor always calls current versions
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave

  const { setupCopy, toastNode } = useContextualCopySetup()

  const propsRef = useRef({ relativePath, language, onSave })
  propsRef.current = { relativePath, language, onSave }
  const currentDiffModelPaths = useDiffViewerLargeDiffLifecycle({
    limited: renderLimit.limited,
    modelKey,
    originalModelKey,
    modifiedModelKey,
    diffEditorRef,
    onEnterFallback: handleEnterLargeDiffFallback
  })

  const handleMount: DiffOnMount = useCallback(
    (diffEditor, monaco) => {
      diffEditorRef.current = diffEditor
      registerDiffEditor(diffEditor)
      lineNumberOptionsSubRef.current?.dispose()
      lineNumberOptionsSubRef.current = applyDiffEditorLineNumberOptions(diffEditor, sideBySide)

      const originalEditor = diffEditor.getOriginalEditor()
      const modifiedEditor = diffEditor.getModifiedEditor()
      originalEditor.updateOptions({ 'semanticHighlighting.enabled': true })
      modifiedEditor.updateOptions({ 'semanticHighlighting.enabled': true })
      diffEditor.onDidDispose(preserveDiffViewStateAcrossModelSwaps(diffEditor).dispose)

      setupCopy(originalEditor, monaco, filePath, propsRef)
      setupCopy(modifiedEditor, monaco, filePath, propsRef)
      setOriginalModel(originalEditor.getModel())
      setModifiedEditor(modifiedEditor)

      // Why: restore full diff view state (not just scrollTop) so cursor/selection stay consistent across both panes.
      const savedViewState = diffViewStateCache.get(modelKey)
      if (savedViewState) {
        requestAnimationFrame(() => diffEditor.restoreViewState(savedViewState))
      }
      // Auto-scroll to first diff lives in a separate effect below so it sequences after the decorator's view zones land.

      if (editable) {
        const cleanupSaveShortcut = installEditorSaveShortcut(
          modifiedEditor.getContainerDomNode(),
          () => {
            onSaveRef.current?.(modifiedEditor.getValue())
          }
        )
        const cleanupOriginalFindShortcut = installMonacoEditorFindShortcut(originalEditor)
        const cleanupModifiedFindShortcut = installMonacoEditorFindShortcut(modifiedEditor)

        modifiedEditor.onDidDispose(() => {
          // Why: this diff instance owns both panes' shortcut bridges, so dispose them with it.
          cleanupSaveShortcut()
          cleanupOriginalFindShortcut()
          cleanupModifiedFindShortcut()
        })

        modifiedEditor.focus()
      } else {
        diffEditor.focus()
      }

      // Why: clear modifiedEditor on dispose so decorator effects don't call into a disposed Monaco editor.
      diffEditor.onDidDispose(() => {
        lineNumberOptionsSubRef.current?.dispose()
        lineNumberOptionsSubRef.current = null
        diffEditorRef.current = null
        unregisterDiffEditor(diffEditor)
        setModifiedEditor(null)
        setOriginalModel(null)
        setPopover(null)
      })
    },
    [editable, setupCopy, modelKey, filePath, sideBySide, registerDiffEditor, unregisterDiffEditor]
  )

  // Why: snapshot view state on deactivation (layoutEffect cleanup fires before unmount), not on scroll.
  useLayoutEffect(() => {
    return () => {
      const de = diffEditorRef.current
      if (de) {
        const currentViewState = de.saveViewState()
        if (currentViewState) {
          setWithLRU(diffViewStateCache, modelKey, currentViewState)
        }
      }
    }
  }, [modelKey])

  useEffect(() => {
    const diffEditor = diffEditorRef.current
    if (!diffEditor) {
      return
    }
    lineNumberOptionsSubRef.current?.dispose()
    lineNumberOptionsSubRef.current = applyDiffEditorLineNumberOptions(diffEditor, sideBySide)
    return () => {
      lineNumberOptionsSubRef.current?.dispose()
      lineNumberOptionsSubRef.current = null
    }
  }, [sideBySide])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div ref={diffBodyRef} className="flex-1 min-h-0 relative">
        {popover && hasLineCommentAction && !renderLimit.limited && (
          <DiffCommentPopover
            key={popover.lineNumber}
            lineNumber={popover.lineNumber}
            startLine={popover.startLine}
            top={popover.top}
            left={popover.left}
            lineHeight={popover.lineHeight}
            placeholder={addLineCommentPlaceholder}
            submitLabel={addLineCommentLabel}
            submittingLabel="Posting…"
            onCancel={() => setPopover(null)}
            onSubmit={handleSubmitComment}
          />
        )}
        {renderLimit.limited ? (
          <LargeDiffFallback
            filePath={relativePath}
            renderLimit={renderLimit}
            action={getDiffViewerLargeDiffSaveAction({
              editable,
              modifiedContent,
              onSave,
              saveContentAvailable: largeDiffSaveContentAvailable
            })}
          />
        ) : (
          <DiffEditor
            key={workingDocumentId ?? modelKey}
            height="100%"
            language={language}
            original={originalContent}
            modified={workingDocumentId ? undefined : modifiedContent}
            theme={monacoThemeName}
            onMount={handleMount}
            // Why: a file can have multiple live diff tabs, so key models off tab identity (not file path) to avoid cross-tab reuse.
            // Why: Changes mode rotates only the original-side model after HEAD moves, preserving the modified side's undo stack.
            originalModelPath={currentDiffModelPaths.originalModelPath}
            modifiedModelPath={workingModelUri ?? currentDiffModelPaths.modifiedModelPath}
            keepCurrentOriginalModel
            keepCurrentModifiedModel
            options={buildDiffViewerEditorOptions({
              editable,
              sideBySide,
              diffEditorFontSize,
              settings
            })}
          />
        )}
        {comparisonError ? (
          <div className="absolute inset-0 z-10">
            <EditorFileLoadErrorView message={comparisonError} onRetry={retryComparison} />
          </div>
        ) : null}
      </div>
      {toastNode}
      <EditorLspStatusChip status={lspStatus} />
    </div>
  )
}
