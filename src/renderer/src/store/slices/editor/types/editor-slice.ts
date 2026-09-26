import type { EditorViewState } from '../actions/editor-view-state'
import type { WorkingDocumentState } from '../working-document-state'
import type { ExplorerDirState } from '../actions/explorer-dir-state'
import type { RightSidebarState } from '../actions/right-sidebar-state'
import type { EditorFilesSlice } from './editor-files-slice'
import type { EditorGitSlice } from './editor-git-slice'

export type EditorSlice = WorkingDocumentState &
  EditorViewState &
  ExplorerDirState &
  RightSidebarState &
  EditorFilesSlice &
  EditorGitSlice
