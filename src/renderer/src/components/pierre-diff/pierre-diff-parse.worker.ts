import { parseDiffFromFile } from '@pierre/diffs'
import type { FileContents } from '@pierre/diffs'

type ParseRequest = { id: number; oldFile: FileContents | null; newFile: FileContents | null }

self.onmessage = (event: MessageEvent<ParseRequest>) => {
  const { id, oldFile, newFile } = event.data
  try {
    self.postMessage({ id, fileDiff: parseDiffFromFile(oldFile, newFile) })
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  }
}
