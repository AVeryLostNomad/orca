import type { Row } from '../grouping/row-types'

type WorktreeItemRow = Extract<Row, { type: 'item' }>
export type RenderRow = Row | { type: 'lineage-group'; key: string; rows: WorktreeItemRow[] }

export function getRenderRowKey(row: RenderRow): string {
  if (row.type === 'header') {
    return `hdr:${row.key}`
  }
  if (row.type === 'lineage-group') {
    return `lineage-group:${row.key}`
  }
  if (row.type === 'imported-worktrees-card') {
    return `imported:${row.key}`
  }
  if (row.type === 'new-external-worktrees-inbox') {
    return `inbox:${row.key}`
  }
  if (row.type === 'pending-creation') {
    return `pending:${row.creationId}`
  }
  if (row.type === 'folder-workspace') {
    return `folder-workspace:${row.folderWorkspace.id}`
  }
  return `wt:${row.rowKey}`
}
