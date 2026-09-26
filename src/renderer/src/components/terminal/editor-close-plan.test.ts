import { describe, expect, it } from 'vitest'
import { getEditorClosePlan } from '@renderer/store/slices/editor/working-document-state'
import type { WorkingDocumentId } from '@/store/slices/editor/working-document'

const DOCUMENT_A = 'document-a' as WorkingDocumentId
const DOCUMENT_B = 'document-b' as WorkingDocumentId

function state({
  memberships,
  dirtyDocumentIds
}: {
  memberships: Record<string, readonly WorkingDocumentId[]>
  dirtyDocumentIds: readonly WorkingDocumentId[]
}) {
  return {
    workingDocumentIdsByTab: memberships,
    workingDocuments: Object.fromEntries(
      [DOCUMENT_A, DOCUMENT_B].map((id) => [id, { id, isDirty: dirtyDocumentIds.includes(id) }])
    )
  } as Parameters<typeof getEditorClosePlan>[0]
}

describe('getEditorClosePlan', () => {
  it('does not prompt when a dirty document keeps another retained view', () => {
    const plan = getEditorClosePlan(
      state({
        memberships: { 'tab-a': [DOCUMENT_A], 'tab-b': [DOCUMENT_A] },
        dirtyDocumentIds: [DOCUMENT_A]
      }),
      ['tab-a']
    )

    expect(plan).toEqual({ tabIds: ['tab-a'], dirtyDocumentIds: [] })
  })

  it('deduplicates final-owner dirty documents across a batch', () => {
    const plan = getEditorClosePlan(
      state({
        memberships: {
          'tab-a': [DOCUMENT_A],
          'tab-b': [DOCUMENT_A],
          'tab-c': [DOCUMENT_B]
        },
        dirtyDocumentIds: [DOCUMENT_A, DOCUMENT_B]
      }),
      ['tab-a', 'tab-b', 'tab-c']
    )

    expect(plan).toEqual({
      tabIds: ['tab-a', 'tab-b', 'tab-c'],
      dirtyDocumentIds: [DOCUMENT_A, DOCUMENT_B]
    })
  })
})
