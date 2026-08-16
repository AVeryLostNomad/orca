/* Why: unified tab / tab group schemas for the persisted workspace session.
 * Split from workspace-session-schema.ts purely along the tab-model boundary;
 * the same read-boundary tolerance policy documented there applies here.
 */
import { z } from 'zod'
import type { TabGroupLayoutNode } from './tab-types'

export const tabContentTypeSchema = z.enum([
  'terminal',
  'editor',
  'diff',
  'conflict-review',
  'check-details',
  'browser',
  'simulator',
  'vscode'
])

export const workspaceVisibleTabTypeSchema = z.enum([
  'terminal',
  'editor',
  'browser',
  'simulator',
  'vscode'
])

export const tabSchema = z.object({
  id: z.string(),
  entityId: z.string(),
  groupId: z.string(),
  worktreeId: z.string(),
  contentType: tabContentTypeSchema,
  label: z.string(),
  generatedLabel: z.string().nullable().optional(),
  aiVaultTitle: z
    .object({
      agent: z.enum(['claude', 'codex']),
      sessionId: z.string(),
      title: z.string()
    })
    .nullable()
    .optional()
    .catch(undefined),
  quickCommandLabel: z.string().nullable().optional(),
  customLabel: z.string().nullable(),
  color: z.string().nullable(),
  sortOrder: z.number(),
  createdAt: z.number(),
  isPreview: z.boolean().optional(),
  isPinned: z.boolean().optional(),
  // Why: persist the per-tab native-chat view mode so 'chat' survives reload /
  // session restore. `.catch('terminal')` tolerates unknown future values (a
  // newer build that wrote an unrecognized mode) by degrading to the safe
  // default instead of failing the whole-session parse. Legacy/missing stays
  // undefined → 'terminal' in the renderer.
  viewMode: z.enum(['terminal', 'chat']).catch('terminal').optional()
})

export const tabGroupSchema = z.object({
  id: z.string(),
  worktreeId: z.string(),
  activeTabId: z.string().nullable(),
  tabOrder: z.array(z.string()),
  recentTabIds: z.array(z.string()).optional()
})

const tabGroupSplitDirectionSchema = z.enum(['horizontal', 'vertical'])

export const tabGroupLayoutNodeSchema: z.ZodType<TabGroupLayoutNode> = z.lazy(() =>
  z.union([
    z.object({
      type: z.literal('leaf'),
      groupId: z.string()
    }),
    z.object({
      type: z.literal('split'),
      direction: tabGroupSplitDirectionSchema,
      first: tabGroupLayoutNodeSchema,
      second: tabGroupLayoutNodeSchema,
      ratio: z.number().optional()
    })
  ])
)

// ─── Code Server (embedded VS Code) ─────────────────────────────────

export const codeServerTabSchema = z.object({
  id: z.string(),
  worktreeId: z.string(),
  folderPath: z.string(),
  label: z.string()
})
