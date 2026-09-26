import type { FileContents, FileDiffMetadata } from '@pierre/diffs'

export const COMPARISON_POLICY_VERSION = 1
export const COMPARISON_BUDGET_MS = 1000
export const LIVE_COMPARISON_DEBOUNCE_MS = 150

export type ComparisonVersion = number | string
export type SerializedRange = [
  startLine: number,
  startColumn: number,
  endLine: number,
  endColumn: number
]
export type SerializedLineChange = {
  originalStartLineNumber: number
  originalEndLineNumberExclusive: number
  modifiedStartLineNumber: number
  modifiedEndLineNumberExclusive: number
  innerChanges?: { originalRange: SerializedRange; modifiedRange: SerializedRange }[]
}

type ComparisonSource = {
  originalContent: string
  modifiedContent: string
  language: string
  showWhitespace: boolean
  originalVersion: ComparisonVersion
  modifiedVersion: ComparisonVersion
  originalIdentity?: string
  modifiedIdentity?: string
}

export type MonacoComparisonInput = ComparisonSource & { output: 'monaco' }
export type PierreComparisonInput = ComparisonSource & {
  output: 'pierre'
  oldFile: FileContents | null
  newFile: FileContents | null
}
export type ComparisonInput = MonacoComparisonInput | PierreComparisonInput
export type ComparisonRequest = ComparisonInput & { id: number }

type ComparisonResponseIdentity = {
  id: number
  originalVersion: ComparisonVersion
  modifiedVersion: ComparisonVersion
}
export type MonacoComparisonResult = ComparisonResponseIdentity & {
  output: 'monaco'
  changes: SerializedLineChange[]
  identical: boolean
  quitEarly: boolean
}
export type PierreComparisonResult = ComparisonResponseIdentity & {
  output: 'pierre'
  fileDiff: FileDiffMetadata
  quitEarly: boolean
}
export type ComparisonResult = MonacoComparisonResult | PierreComparisonResult
export type ComparisonFailure = ComparisonResponseIdentity & {
  output: 'error'
  error: string
}
export type ComparisonResponse = ComparisonResult | ComparisonFailure
