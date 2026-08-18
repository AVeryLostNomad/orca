import { join } from 'node:path'
import type { LspServerId } from '../../shared/lsp-types'
import { LSP_SERVER_LANGUAGE_IDS } from '../../shared/lsp-language-support'
import nodeBundleConfig from '../../../config/lsp-node-server-bundles.json'

export type LspNodeBundlePin = {
  bundleId: string
  version: string
  asset: string
  sha256: string
  servers: Record<string, { entryRelativePath: string; extraArgs?: string[] }>
}

export type LspAcquisitionSpec =
  | { kind: 'node-bundle'; bundleId: string }
  | { kind: 'github-binary' }
  | { kind: 'user-toolchain'; toolchain: 'go' }

export type LspServerRegistryEntry = {
  id: LspServerId
  displayName: string
  acquisition: LspAcquisitionSpec
  /** Extra args after the entry; node bundles may add pinned extraArgs first. */
  args?: string[]
  initializationOptions?: (context: { installRoot: string }) => unknown
  /** Static answer for workspace/configuration requests (section-keyed). */
  workspaceConfiguration?: Record<string, unknown>
}

export const LSP_NODE_BUNDLE_RELEASE_TAG: string = nodeBundleConfig.releaseTag

export function lspNodeBundlePin(bundleId: string): LspNodeBundlePin | undefined {
  const bundles = nodeBundleConfig.bundles as Record<string, LspNodeBundlePin>
  return bundles[bundleId]
}

const REGISTRY: LspServerRegistryEntry[] = [
  {
    id: 'typescript',
    displayName: 'TypeScript',
    acquisition: { kind: 'node-bundle', bundleId: 'typescript-language-server' },
    args: ['--stdio'],
    // Workspace-installed typescript wins; the bundled copy is the fallback so
    // projects without node_modules still get intellisense.
    initializationOptions: ({ installRoot }) => ({
      tsserver: {
        fallbackPath: join(installRoot, 'node_modules', 'typescript', 'lib')
      }
    })
  },
  {
    id: 'json',
    displayName: 'JSON',
    acquisition: { kind: 'node-bundle', bundleId: 'vscode-langservers' },
    args: ['--stdio'],
    initializationOptions: () => ({ provideFormatter: true }),
    workspaceConfiguration: { json: { validate: { enable: true }, format: { enable: true } } }
  },
  {
    id: 'css',
    displayName: 'CSS',
    acquisition: { kind: 'node-bundle', bundleId: 'vscode-langservers' },
    args: ['--stdio'],
    workspaceConfiguration: {
      css: { validate: true },
      scss: { validate: true },
      less: { validate: true }
    }
  },
  {
    id: 'html',
    displayName: 'HTML',
    acquisition: { kind: 'node-bundle', bundleId: 'vscode-langservers' },
    args: ['--stdio'],
    initializationOptions: () => ({ provideFormatter: true })
  },
  {
    id: 'yaml',
    displayName: 'YAML',
    acquisition: { kind: 'node-bundle', bundleId: 'yaml-language-server' },
    args: ['--stdio'],
    workspaceConfiguration: {
      yaml: { validate: true, hover: true, completion: true, schemaStore: { enable: true } }
    }
  },
  {
    id: 'pyright',
    displayName: 'Python (Pyright)',
    acquisition: { kind: 'node-bundle', bundleId: 'pyright' },
    args: ['--stdio'],
    workspaceConfiguration: {
      python: { analysis: { autoSearchPaths: true, useLibraryCodeForTypes: true } }
    }
  },
  {
    id: 'bash',
    displayName: 'Bash',
    acquisition: { kind: 'node-bundle', bundleId: 'bash-language-server' }
  },
  {
    id: 'dockerfile',
    displayName: 'Dockerfile',
    acquisition: { kind: 'node-bundle', bundleId: 'dockerfile-language-server' },
    args: ['--stdio']
  },
  {
    id: 'intelephense',
    displayName: 'PHP (Intelephense)',
    acquisition: { kind: 'node-bundle', bundleId: 'intelephense' },
    args: ['--stdio']
  },
  {
    id: 'vue',
    displayName: 'Vue',
    acquisition: { kind: 'node-bundle', bundleId: 'vue-language-server' },
    args: ['--stdio'],
    initializationOptions: ({ installRoot }) => ({
      typescript: { tsdk: join(installRoot, 'node_modules', 'typescript', 'lib') }
    })
  },
  {
    id: 'rust-analyzer',
    displayName: 'Rust (rust-analyzer)',
    acquisition: { kind: 'github-binary' }
  },
  {
    id: 'clangd',
    displayName: 'C/C++ (clangd)',
    acquisition: { kind: 'github-binary' }
  },
  {
    id: 'lua',
    displayName: 'Lua',
    acquisition: { kind: 'github-binary' }
  },
  {
    id: 'marksman',
    displayName: 'Markdown (Marksman)',
    acquisition: { kind: 'github-binary' }
  },
  {
    id: 'taplo',
    displayName: 'TOML (Taplo)',
    acquisition: { kind: 'github-binary' },
    args: ['lsp', 'stdio']
  },
  {
    id: 'terraform',
    displayName: 'Terraform',
    acquisition: { kind: 'github-binary' },
    args: ['serve']
  },
  {
    id: 'gopls',
    displayName: 'Go (gopls)',
    acquisition: { kind: 'user-toolchain', toolchain: 'go' }
  }
]

const REGISTRY_BY_ID = new Map(REGISTRY.map((entry) => [entry.id, entry]))

export function getLspServerRegistry(): readonly LspServerRegistryEntry[] {
  return REGISTRY
}

export function getLspServerEntry(serverId: LspServerId): LspServerRegistryEntry | undefined {
  return REGISTRY_BY_ID.get(serverId)
}

export function lspServerLanguageIds(serverId: LspServerId): string[] {
  return LSP_SERVER_LANGUAGE_IDS[serverId] ?? []
}
