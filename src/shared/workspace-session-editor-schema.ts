import { z } from 'zod'
import { executionHostIdSchema } from './execution-host-schema'

export const persistedOpenFileSchema = z.object({
  filePath: z.string(),
  relativePath: z.string(),
  worktreeId: z.string(),
  language: z.string(),
  isPreview: z.boolean().optional(),
  // Optional for sessions written before document ownership was explicit.
  executionHostId: executionHostIdSchema.optional(),
  runtimeEnvironmentId: z.string().nullable().optional(),
  mirroredFromRuntimeSession: z.literal(true).optional(),
  externalSshTargetId: z.string().trim().min(1).optional(),
  dirtyDraftContent: z.string().optional(),
  lastKnownDiskSignature: z.string().optional(),
  readOnly: z.boolean().optional(),
  liveTail: z.boolean().optional(),
  alwaysAutoSave: z.boolean().optional(),
  workspaceNotesOwnerId: z.string().optional(),
  isScratch: z.boolean().optional()
})
