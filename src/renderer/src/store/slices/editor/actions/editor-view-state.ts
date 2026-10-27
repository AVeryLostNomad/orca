import type { EditorGet, EditorSet } from '../types/editor-set-get'
import type { EditorViewMode, MarkdownViewMode } from '../types/open-file'
import { clampMarkdownTocPanelWidth } from '../../../../../../shared/markdown-toc-panel-width'
import {
  clampCombinedDiffFileTreeWidth,
  COMBINED_DIFF_FILE_TREE_DEFAULT_WIDTH
} from '../../../../../../shared/combined-diff-file-tree-width'

export type EditorViewState = {
  /** Paged CSV previews are never editable buffers; set by the content loader. */
  setCsvPreviewOnly: (fileId: string, enabled: boolean) => void
  markdownViewMode: Record<string, MarkdownViewMode>
  setMarkdownViewMode: (fileId: string, mode: MarkdownViewMode) => void
  markdownRichModeSizeOverride: Record<string, boolean>
  setMarkdownRichModeSizeOverride: (fileId: string, enabled: boolean) => void
  editorViewMode: Record<string, EditorViewMode>
  setEditorViewMode: (fileId: string, mode: EditorViewMode) => void
  markdownFrontmatterVisible: Record<string, boolean>
  setMarkdownFrontmatterVisible: (fileId: string, visible: boolean) => void
  markdownTableOfContentsVisible: Record<string, boolean>
  setMarkdownTableOfContentsVisible: (fileId: string, visible: boolean) => void
  markdownTocPanelWidth: number
  setMarkdownTocPanelWidth: (width: number) => void
  combinedDiffFileTreeWidth: number
  setCombinedDiffFileTreeWidth: (width: number) => void
}

export function createEditorViewState(set: EditorSet, _get: EditorGet): EditorViewState {
  return {
    setCsvPreviewOnly: (fileId, enabled) =>
      set((state) => {
        const file = state.openFiles.find((candidate) => candidate.id === fileId)
        if (!file || Boolean(file.csvPreviewOnly) === enabled) {
          return state
        }
        return {
          openFiles: state.openFiles.map((candidate) =>
            candidate.id === fileId
              ? { ...candidate, csvPreviewOnly: enabled || undefined }
              : candidate
          )
        }
      }),
    markdownViewMode: {},
    setMarkdownViewMode: (fileId, mode) =>
      set((s) => ({
        markdownViewMode: { ...s.markdownViewMode, [fileId]: mode }
      })),

    markdownRichModeSizeOverride: {},
    setMarkdownRichModeSizeOverride: (fileId, enabled) =>
      set((s) => {
        // Why: default is false — delete rather than store it so the record stays minimal.
        if (!enabled) {
          if (!(fileId in s.markdownRichModeSizeOverride)) {
            return s
          }
          const next = { ...s.markdownRichModeSizeOverride }
          delete next[fileId]
          return { markdownRichModeSizeOverride: next }
        }
        return {
          markdownRichModeSizeOverride: { ...s.markdownRichModeSizeOverride, [fileId]: true }
        }
      }),

    editorViewMode: {},
    setEditorViewMode: (fileId, mode) =>
      set((s) => {
        // Why: default is 'edit' — delete rather than store it so the record stays minimal and hydration round-trips cleanly.
        if (mode === 'edit') {
          if (!(fileId in s.editorViewMode)) {
            return s
          }
          const next = { ...s.editorViewMode }
          delete next[fileId]
          return { editorViewMode: next }
        }
        return { editorViewMode: { ...s.editorViewMode, [fileId]: mode } }
      }),

    markdownFrontmatterVisible: {},
    setMarkdownFrontmatterVisible: (fileId, visible) =>
      set((s) => {
        // Why: don't persist the default value; delete instead so the map carries only overrides and hydration round-trips cleanly.
        if (visible) {
          if (!(fileId in s.markdownFrontmatterVisible)) {
            return s
          }
          const next = { ...s.markdownFrontmatterVisible }
          delete next[fileId]
          return { markdownFrontmatterVisible: next }
        }
        return { markdownFrontmatterVisible: { ...s.markdownFrontmatterVisible, [fileId]: false } }
      }),

    markdownTableOfContentsVisible: {},
    setMarkdownTableOfContentsVisible: (fileId, visible) =>
      set((s) => {
        if (!visible) {
          if (!(fileId in s.markdownTableOfContentsVisible)) {
            return s
          }
          const next = { ...s.markdownTableOfContentsVisible }
          delete next[fileId]
          return { markdownTableOfContentsVisible: next }
        }
        return {
          markdownTableOfContentsVisible: {
            ...s.markdownTableOfContentsVisible,
            [fileId]: true
          }
        }
      }),

    markdownTocPanelWidth: 240,
    setMarkdownTocPanelWidth: (width) =>
      set((s) => ({
        markdownTocPanelWidth: clampMarkdownTocPanelWidth(width, undefined, s.markdownTocPanelWidth)
      })),

    combinedDiffFileTreeWidth: COMBINED_DIFF_FILE_TREE_DEFAULT_WIDTH,
    setCombinedDiffFileTreeWidth: (width) =>
      set((s) => ({
        combinedDiffFileTreeWidth: clampCombinedDiffFileTreeWidth(
          width,
          undefined,
          s.combinedDiffFileTreeWidth
        )
      }))
  }
}
