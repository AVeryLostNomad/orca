import type { EditorGet, EditorSet } from '../types/editor-set-get'
import type { EditorViewMode, MarkdownViewMode } from '../types/open-file'
import { clampMarkdownTocPanelWidth } from '../../../../../../shared/markdown-toc-panel-width'
import {
  clampCombinedDiffFileTreeWidth,
  COMBINED_DIFF_FILE_TREE_DEFAULT_WIDTH
} from '../../../../../../shared/combined-diff-file-tree-width'

export type EditorViewState = {
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
    markdownViewMode: {},
    setMarkdownViewMode: (fileId, mode) =>
      set((state) => ({
        markdownViewMode: { ...state.markdownViewMode, [fileId]: mode }
      })),
    markdownRichModeSizeOverride: {},
    setMarkdownRichModeSizeOverride: (fileId, enabled) =>
      set((state) => {
        if (state.markdownRichModeSizeOverride[fileId] === enabled) {
          return state
        }
        return {
          markdownRichModeSizeOverride: {
            ...state.markdownRichModeSizeOverride,
            [fileId]: enabled
          }
        }
      }),
    editorViewMode: {},
    setEditorViewMode: (fileId, mode) =>
      set((state) => {
        if (state.editorViewMode[fileId] === mode) {
          return state
        }
        return { editorViewMode: { ...state.editorViewMode, [fileId]: mode } }
      }),
    markdownFrontmatterVisible: {},
    setMarkdownFrontmatterVisible: (fileId, visible) =>
      set((state) => {
        if (state.markdownFrontmatterVisible[fileId] === visible) {
          return state
        }
        return {
          markdownFrontmatterVisible: { ...state.markdownFrontmatterVisible, [fileId]: visible }
        }
      }),
    markdownTableOfContentsVisible: {},
    setMarkdownTableOfContentsVisible: (fileId, visible) =>
      set((state) => {
        if (state.markdownTableOfContentsVisible[fileId] === visible) {
          return state
        }
        return {
          markdownTableOfContentsVisible: {
            ...state.markdownTableOfContentsVisible,
            [fileId]: visible
          }
        }
      }),
    markdownTocPanelWidth: 240,
    setMarkdownTocPanelWidth: (width) =>
      set((state) => ({
        markdownTocPanelWidth: clampMarkdownTocPanelWidth(
          width,
          undefined,
          state.markdownTocPanelWidth
        )
      })),
    combinedDiffFileTreeWidth: COMBINED_DIFF_FILE_TREE_DEFAULT_WIDTH,
    setCombinedDiffFileTreeWidth: (width) =>
      set((state) => ({
        combinedDiffFileTreeWidth: clampCombinedDiffFileTreeWidth(
          width,
          state.combinedDiffFileTreeWidth
        )
      }))
  }
}
