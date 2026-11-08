import { join } from 'node:path'
import type { LspServerId } from '../../shared/lsp-types'
import { LSP_SERVER_LANGUAGE_IDS } from '../../shared/lsp-language-support'
import nodeBundleConfig from '../../../config/lsp-node-server-bundles.json'
import { lspRootDir } from './lsp-install-paths'
import {
  openRoslynWorkspace,
  restoreRoslynProjects,
  roslynUnityProjectGate,
  roslynWorkspaceArgs
} from './lsp-roslyn-workspace'

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
  /** Roslyn run by a dotnet host (user's if it qualifies, else a private SDK). */
  | { kind: 'dotnet-roslyn' }

export type LspServerHookContext = {
  rootPath: string
  notify: (method: string, params: unknown) => void
  request: (method: string, params: unknown) => Promise<unknown>
}

export type LspServerRegistryEntry = {
  id: LspServerId
  displayName: string
  acquisition: LspAcquisitionSpec
  /** Extra args after the entry; node bundles may add pinned extraArgs first. */
  args?: string[]
  /** Args that need the resolved install location (appended after `args`). */
  installArgs?: (context: { installRoot: string }) => string[]
  /** Args that depend on the opened workspace (resolved per session, appended last). */
  workspaceArgs?: (context: { rootPath: string }) => Promise<string[]>
  initializationOptions?: (context: { installRoot: string }) => unknown
  /** Static answer for workspace/configuration requests (section-keyed). */
  workspaceConfiguration?: Record<string, unknown>
  /** Runs after `initialized` (e.g. telling the server which projects to load). */
  afterInitialized?: (context: LspServerHookContext) => Promise<void>
  /** Notification the server sends once its projects finish loading. */
  projectLoadedNotification?: string
  /** Server→client requests answered in main instead of the renderer. */
  serverRequestHandlers?: Record<
    string,
    (params: unknown, context: LspServerHookContext) => unknown
  >
  /** Checked before acquisition: a reason string refuses the session for this
   *  workspace without installing or spawning anything. */
  sessionGate?: (context: { rootPath: string }) => Promise<string | null>
}

export const LSP_NODE_BUNDLE_RELEASE_TAG: string = nodeBundleConfig.releaseTag

export function lspNodeBundlePin(bundleId: string): LspNodeBundlePin | undefined {
  const bundles = nodeBundleConfig.bundles as Record<string, LspNodeBundlePin>
  return bundles[bundleId]
}

// Roslyn requests per-language options as `csharp|<group>.<option>` and global
// ones as `<group>.<option>` (observed); the resolver splits on '.'.
// Rider-like defaults: parameter hints on, `var` type hints off.
const ROSLYN_WORKSPACE_CONFIGURATION: Record<string, unknown> = {
  'csharp|inlay_hints': {
    dotnet_enable_inlay_hints_for_parameters: true,
    dotnet_enable_inlay_hints_for_literal_parameters: true,
    dotnet_enable_inlay_hints_for_indexer_parameters: true,
    dotnet_enable_inlay_hints_for_object_creation_parameters: true,
    dotnet_enable_inlay_hints_for_other_parameters: false,
    dotnet_suppress_inlay_hints_for_parameters_that_differ_only_by_suffix: true,
    dotnet_suppress_inlay_hints_for_parameters_that_match_method_intent: true,
    dotnet_suppress_inlay_hints_for_parameters_that_match_argument_name: true,
    csharp_enable_inlay_hints_for_types: false,
    csharp_enable_inlay_hints_for_implicit_variable_types: false,
    csharp_enable_inlay_hints_for_lambda_parameter_types: false,
    csharp_enable_inlay_hints_for_implicit_object_creation: false,
    csharp_enable_inlay_hints_for_collection_expressions: false
  },
  'csharp|completion': {
    dotnet_show_completion_items_from_unimported_namespaces: true,
    dotnet_provide_regex_completions: true,
    dotnet_show_name_completion_suggestions: true,
    dotnet_trigger_completion_in_argument_lists: true
  },
  'csharp|background_analysis': {
    dotnet_analyzer_diagnostics_scope: 'openFiles',
    dotnet_compiler_diagnostics_scope: 'openFiles'
  },
  'csharp|code_lens': {
    dotnet_enable_references_code_lens: true,
    dotnet_enable_tests_code_lens: false
  },
  'csharp|symbol_search': { dotnet_search_reference_assemblies: true },
  'csharp|highlighting': {
    dotnet_highlight_related_regex_components: true,
    dotnet_highlight_related_json_components: true
  },
  'csharp|quick_info': { dotnet_show_remarks_in_quick_info: true },
  'csharp|auto_insert': { dotnet_enable_auto_insert: true },
  navigation: {
    dotnet_navigate_to_decompiled_sources: true,
    dotnet_navigate_to_source_link_and_embedded_sources: true
  },
  projects: { dotnet_enable_automatic_restore: true }
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
    id: 'angular',
    displayName: 'Angular',
    acquisition: { kind: 'node-bundle', bundleId: 'angular-language-server' },
    args: ['--stdio'],
    // Probe locations are fallbacks; ngserver prefers the workspace's own
    // typescript/@angular/language-service when present.
    installArgs: ({ installRoot }) => {
      const probe = join(installRoot, 'node_modules')
      return ['--tsProbeLocations', probe, '--ngProbeLocations', probe]
    }
  },
  {
    id: 'json',
    displayName: 'JSON',
    acquisition: { kind: 'node-bundle', bundleId: 'vscode-langservers' },
    args: ['--stdio'],
    initializationOptions: () => ({ provideFormatter: true }),
    workspaceConfiguration: {
      json: {
        validate: { enable: true },
        format: { enable: true },
        schemas: [
          { fileMatch: ['*.asmdef'], url: 'https://www.schemastore.org/asmdef.json' },
          // SchemaStore has no asmref schema; the format is a single reference.
          {
            fileMatch: ['*.asmref'],
            schema: {
              type: 'object',
              properties: {
                reference: {
                  type: 'string',
                  description:
                    'Assembly Definition this folder joins: its name, or "GUID:<asmdef guid>".'
                }
              },
              required: ['reference']
            }
          }
        ]
      }
    }
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
  },
  {
    id: 'csharp',
    displayName: 'C# (Roslyn)',
    acquisition: { kind: 'dotnet-roslyn' },
    args: ['--logLevel', 'Information', '--telemetryLevel', 'off', '--stdio'],
    installArgs: () => ['--extensionLogDirectory', join(lspRootDir(), 'logs', 'csharp')],
    workspaceArgs: roslynWorkspaceArgs,
    afterInitialized: openRoslynWorkspace,
    projectLoadedNotification: 'workspace/projectInitializationComplete',
    serverRequestHandlers: { 'workspace/_roslyn_projectNeedsRestore': restoreRoslynProjects },
    workspaceConfiguration: ROSLYN_WORKSPACE_CONFIGURATION,
    // Roslyn + a private .NET SDK is a heavy download; only Unity projects get it.
    sessionGate: roslynUnityProjectGate
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
