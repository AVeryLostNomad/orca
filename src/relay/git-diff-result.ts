import * as path from 'node:path'
import { getLargeDiffRenderLimit } from '../shared/large-diff-render-limit'
import type { GitDiffReadState } from './git-blob-read-state'
import { PREVIEWABLE_MIME } from './git-handler-utils'

type GitDiffReadStates = {
  originalReadState?: GitDiffReadState
  modifiedReadState?: GitDiffReadState
}

export function buildDiffResult(
  originalContent: string,
  modifiedContent: string,
  originalIsBinary: boolean,
  modifiedIsBinary: boolean,
  filePath?: string,
  readStates?: GitDiffReadStates
) {
  if (originalIsBinary || modifiedIsBinary) {
    const ext = filePath ? path.extname(filePath).toLowerCase() : ''
    const mimeType = PREVIEWABLE_MIME[ext]
    return {
      kind: 'binary' as const,
      originalContent,
      modifiedContent,
      originalIsBinary,
      modifiedIsBinary,
      ...readStates,
      ...(mimeType ? { isImage: true, mimeType } : {})
    }
  }

  const largeDiffRenderLimit = getLargeDiffRenderLimit({ originalContent, modifiedContent })
  if (largeDiffRenderLimit.limited) {
    return {
      kind: 'text' as const,
      originalContent: '',
      modifiedContent: '',
      originalIsBinary: false,
      modifiedIsBinary: false,
      ...readStates,
      largeDiffRenderLimit
    }
  }

  return {
    kind: 'text' as const,
    originalContent,
    modifiedContent,
    originalIsBinary: false,
    modifiedIsBinary: false,
    ...readStates
  }
}
