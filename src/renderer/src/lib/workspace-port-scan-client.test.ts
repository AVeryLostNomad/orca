import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  WORKSPACE_PORT_ATTRIBUTION_CONFIDENCES,
  type WorkspacePortScanResult
} from '../../../shared/workspace-ports'
import { runWorkspacePortScanForTarget } from './workspace-port-scan-client'

function scanWithConfidence(confidence: string): WorkspacePortScanResult {
  return {
    platform: 'win32',
    scannedAt: 1,
    ports: [
      {
        id: '::1:5183:3328',
        bindHost: '::1',
        connectHost: '::1',
        port: 5183,
        pid: 3328,
        processName: 'node.exe',
        protocol: 'unknown',
        kind: 'workspace',
        owner: {
          worktreeId: 'repo::C:/work/app',
          repoId: 'repo',
          displayName: 'app',
          path: 'C:/work/app',
          confidence: confidence as never
        }
      }
    ]
  }
}

function stubLocalScan(result: WorkspacePortScanResult): void {
  vi.stubGlobal('window', {
    ...globalThis.window,
    api: { workspacePorts: { scan: vi.fn().mockResolvedValue(result) } }
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('runWorkspacePortScanForTarget response validation', () => {
  // A hand-copied confidence enum once rejected every local scan that contained a terminal-attributed port.
  it.each(WORKSPACE_PORT_ATTRIBUTION_CONFIDENCES)('accepts %s-attributed ports', async (c) => {
    const scan = scanWithConfidence(c)
    stubLocalScan(scan)
    await expect(runWorkspacePortScanForTarget({ kind: 'local' })).resolves.toEqual(scan)
  })

  it('rejects an unknown attribution confidence', async () => {
    stubLocalScan(scanWithConfidence('guess'))
    await expect(runWorkspacePortScanForTarget({ kind: 'local' })).rejects.toThrow(
      /invalid response/
    )
  })
})
