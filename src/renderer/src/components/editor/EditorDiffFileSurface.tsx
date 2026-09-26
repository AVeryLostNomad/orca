import { translate } from '@/i18n/i18n'
import { detectLanguage } from '@/lib/language-detect'
import type { OpenFile } from '@/store/slices/editor'
import type { GitDiffResult } from '../../../../shared/git-diff-compare-types'
import { DiffViewer, ImageDiffViewer, MarkdownPreview, PierreFileDiff } from './editor-lazy-views'
import { ExternalFileChangeBanner } from './ExternalFileChangeBanner'
import type { useMarkdownDocuments } from './useMarkdownDocuments'
import type { WorkingDocument } from '@/store/slices/editor/working-document'
import type { FileContent } from './editor-panel-content-types'
import { EditorFileLoadErrorView } from './EditorFileLoadErrorView'

type MarkdownDocumentsController = ReturnType<typeof useMarkdownDocuments>

export function EditorDiffFileSurface({
  activeFile,
  workingDocument,
  fileContent,
  onSave,
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
  workingDocument?: WorkingDocument
  fileContent?: FileContent
  onSave: (content: string) => Promise<boolean>
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
  if (!diffContent) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        {translate('auto.components.editor.EditorContent.c88c73a0d3', 'Loading diff...')}
      </div>
    )
  }

  const isEditable =
    activeFile.diffSource === 'unstaged' &&
    workingDocument?.loadState === 'ready' &&
    workingDocument.writable
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
  if (fileContent?.loadError) {
    return (
      <EditorFileLoadErrorView
        message={fileContent.loadError}
        onRetry={() => reloadContent(activeFile)}
      />
    )
  }

  const modifiedDiffContent = workingDocument?.content ?? editBuffer ?? diffContent.modifiedContent
  const externalChangeBanner =
    workingDocument?.externalMutation === 'changed' ? (
      <ExternalFileChangeBanner document={workingDocument} currentContent={modifiedDiffContent} />
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
  const diffViewer = isEditable ? (
    <DiffViewer
      modelKey={diffViewStateKey}
      workingDocumentId={workingDocument.id}
      originalContent={diffContent.originalContent}
      modifiedContent={modifiedDiffContent}
      filePath={activeFile.filePath}
      relativePath={activeFile.relativePath}
      language={detectLanguage(activeFile.relativePath)}
      sideBySide={sideBySide}
      worktreeId={activeFile.worktreeId}
      onSave={onSave}
      largeDiffRenderLimit={diffContent.largeDiffRenderLimit}
    />
  ) : (
    <PierreFileDiff
      // Why: key off the reload nonce so refreshed blobs remount cleanly; content identity is handled via cacheKey.
      key={`${viewStateScopeId}:${diffReloadNonce}`}
      scrollKey={diffViewStateKey}
      originalContent={diffContent.originalContent}
      modifiedContent={modifiedDiffContent}
      originalReadState={diffContent.originalReadState}
      modifiedReadState={diffContent.modifiedReadState}
      relativePath={activeFile.relativePath}
      language={detectLanguage(activeFile.relativePath)}
      sideBySide={sideBySide}
      worktreeId={activeFile.worktreeId}
      largeDiffRenderLimit={diffContent.largeDiffRenderLimit}
    />
  )
  if (workingDocument?.externalMutation !== 'changed') {
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
