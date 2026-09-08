import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { detectLanguage } from '@/lib/language-detect'
import { useAppStore } from '@/store'
import type { OpenFile } from '@/store/slices/editor'
import type { GitDiffResult } from '../../../../shared/git-diff-compare-types'
import { ImageDiffViewer, MarkdownPreview, PierreFileDiff } from './editor-lazy-views'
import { ExternalFileChangeBanner } from './ExternalFileChangeBanner'
import type { useMarkdownDocuments } from './useMarkdownDocuments'

type MarkdownDocumentsController = ReturnType<typeof useMarkdownDocuments>

export function EditorDiffFileSurface({
  activeFile,
  diffContent,
  editBuffer,
  sideBySide,
  viewStateScopeId,
  diffViewStateKey,
  mdViewMode,
  isMarkdown,
  showMarkdownTableOfContents,
  onCloseMarkdownTableOfContents,
  markdownAnnotationsEnabled,
  markdownDocuments,
  reloadContent
}: {
  activeFile: OpenFile
  diffContent: GitDiffResult | undefined
  editBuffer: string | undefined
  sideBySide: boolean
  viewStateScopeId: string
  diffViewStateKey: string
  mdViewMode: 'source' | 'preview' | 'rich'
  isMarkdown: boolean
  showMarkdownTableOfContents: boolean
  onCloseMarkdownTableOfContents: () => void
  markdownAnnotationsEnabled: boolean
  markdownDocuments: MarkdownDocumentsController
  reloadContent: (file: OpenFile) => void
}): React.JSX.Element {
  const openFile = useAppStore((state) => state.openFile)
  if (!diffContent) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        {translate('auto.components.editor.EditorContent.c88c73a0d3', 'Loading diff...')}
      </div>
    )
  }

  const isEditable = activeFile.diffSource === 'unstaged'
  if (diffContent.kind === 'binary') {
    if (diffContent.isImage) {
      return (
        <ImageDiffViewer
          originalContent={diffContent.originalContent}
          modifiedContent={diffContent.modifiedContent}
          filePath={activeFile.relativePath}
          mimeType={diffContent.mimeType}
          sideBySide={sideBySide}
        />
      )
    }
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <div className="space-y-2">
          <div className="text-sm font-medium text-foreground">
            {translate('auto.components.editor.EditorContent.78541e254e', 'Binary file changed')}
          </div>
          <div className="text-xs text-muted-foreground">
            {activeFile.diffSource === 'branch'
              ? translate(
                  'auto.components.editor.EditorContent.3c6e71df22',
                  'Text diff is unavailable for this file in branch compare.'
                )
              : translate(
                  'auto.components.editor.EditorContent.8a0898ae4c',
                  'Text diff is unavailable for this file.'
                )}
          </div>
        </div>
      </div>
    )
  }

  const modifiedDiffContent = editBuffer ?? diffContent.modifiedContent
  const externalChangeBanner =
    activeFile.externalMutation === 'changed' ? (
      <ExternalFileChangeBanner
        file={activeFile}
        currentContent={modifiedDiffContent}
        reloadContent={reloadContent}
      />
    ) : null

  if (
    isMarkdown &&
    mdViewMode === 'preview' &&
    diffContent.largeDiffRenderLimit?.limited !== true
  ) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {externalChangeBanner}
        <div className="border-b border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {/* Why: markdown preview can't show additions and deletions at once, so it shows only the modified side. */}
          {translate(
            'auto.components.editor.EditorContent.9640d1d3db',
            'Previewing the modified version of this diff. Switch to source mode to inspect changes.'
          )}
        </div>
        <div className="min-h-0 flex-1">
          <MarkdownPreview
            key={viewStateScopeId}
            content={modifiedDiffContent}
            filePath={activeFile.filePath}
            sourceFileId={activeFile.id}
            sourceWorktreeId={activeFile.worktreeId}
            sourceRuntimeEnvironmentId={activeFile.runtimeEnvironmentId}
            scrollCacheKey={`${diffViewStateKey}:preview`}
            showTableOfContents={showMarkdownTableOfContents}
            onCloseTableOfContents={onCloseMarkdownTableOfContents}
            markdownAnnotationsEnabled={markdownAnnotationsEnabled}
            {...markdownDocuments.previewProps}
          />
        </div>
      </div>
    )
  }

  const diffReloadNonce = activeFile.diffContentReloadNonce ?? 0
  // Why: diff tabs are read-only in the Pierre renderer; "Edit file" jumps to a
  // regular editor tab where unstaged content can actually be changed.
  const editFileAction = isEditable ? (
    <Button
      variant="ghost"
      size="sm"
      className="h-6 px-2 text-xs"
      onClick={() =>
        openFile(
          {
            filePath: activeFile.filePath,
            relativePath: activeFile.relativePath,
            worktreeId: activeFile.worktreeId,
            language: detectLanguage(activeFile.relativePath),
            mode: 'edit',
            runtimeEnvironmentId: activeFile.runtimeEnvironmentId
          },
          { focusEditor: true }
        )
      }
    >
      {translate('auto.components.editor.EditorContent.d6aa8b56a3', 'Edit file')}
    </Button>
  ) : null
  const diffViewer = (
    <PierreFileDiff
      // Why: key off the reload nonce so refreshed blobs remount cleanly; content identity is handled via cacheKey.
      key={`${viewStateScopeId}:${diffReloadNonce}`}
      scrollKey={diffViewStateKey}
      originalContent={diffContent.originalContent}
      modifiedContent={modifiedDiffContent}
      relativePath={activeFile.relativePath}
      sideBySide={sideBySide}
      worktreeId={activeFile.worktreeId}
      largeDiffRenderLimit={diffContent.largeDiffRenderLimit}
      headerActions={editFileAction}
    />
  )
  if (activeFile.externalMutation !== 'changed') {
    return diffViewer
  }
  return (
    // Why: parent isn't a flex container, so flex-1 collapses to 0px — use h-full here and a flex column inside.
    <div className="flex h-full min-h-0 flex-col">
      {externalChangeBanner}
      <div className="flex min-h-0 flex-1 flex-col">{diffViewer}</div>
    </div>
  )
}
