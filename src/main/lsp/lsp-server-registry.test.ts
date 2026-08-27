import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/orca-test-user-data' },
  net: { request: vi.fn() }
}))

import {
  LSP_PROJECT_SERVER_OVERRIDES,
  LSP_SERVER_LANGUAGE_IDS
} from '../../shared/lsp-language-support'
import { getLspServerRegistry, lspNodeBundlePin, lspServerLanguageIds } from './lsp-server-registry'
import nodeBundleConfig from '../../../config/lsp-node-server-bundles.json'
import binaryAssetConfig from '../../../config/lsp-binary-assets.json'

const SHA256_PATTERN = /^[0-9a-f]{64}$/

describe('lsp server registry integrity', () => {
  it('covers every server id in the shared language map (and vice versa)', () => {
    const registryIds = getLspServerRegistry()
      .map((entry) => entry.id)
      .sort()
    const languageMapIds = Object.keys(LSP_SERVER_LANGUAGE_IDS).sort()
    expect(registryIds).toEqual(languageMapIds)
    for (const id of registryIds) {
      expect(lspServerLanguageIds(id).length).toBeGreaterThan(0)
    }
  })

  it('maps each language to at most one base server', () => {
    const overrideServers = new Set(Object.values(LSP_PROJECT_SERVER_OVERRIDES))
    const seen = new Map<string, string>()
    for (const [serverId, languages] of Object.entries(LSP_SERVER_LANGUAGE_IDS)) {
      if (overrideServers.has(serverId as never)) {
        continue
      }
      for (const language of languages) {
        expect(seen.get(language), `${language} claimed twice`).toBeUndefined()
        seen.set(language, serverId)
      }
    }
  })

  it('overrides only claim languages their base server already covers', () => {
    for (const [baseId, overrideId] of Object.entries(LSP_PROJECT_SERVER_OVERRIDES)) {
      const baseLanguages = new Set(LSP_SERVER_LANGUAGE_IDS[baseId as never] as string[])
      for (const language of LSP_SERVER_LANGUAGE_IDS[overrideId as never] as string[]) {
        expect(baseLanguages.has(language), `${overrideId} claims ${language}`).toBe(true)
      }
    }
  })

  it('pins every node-bundle server with a sha256 and entry path', () => {
    for (const entry of getLspServerRegistry()) {
      if (entry.acquisition.kind !== 'node-bundle') {
        continue
      }
      const pin = lspNodeBundlePin(entry.acquisition.bundleId)
      expect(pin, `missing bundle pin for ${entry.id}`).toBeDefined()
      expect(pin?.sha256).toMatch(SHA256_PATTERN)
      expect(pin?.asset.endsWith('.tar.gz')).toBe(true)
      const serverPin = pin?.servers[entry.id]
      expect(serverPin?.entryRelativePath, `missing entry for ${entry.id}`).toBeTruthy()
      expect(serverPin?.entryRelativePath.startsWith('node_modules/')).toBe(true)
    }
    expect(nodeBundleConfig.releaseTag).toMatch(/^lsp-node-bundles-v\d+$/)
  })

  it('pins every github-binary server for the major platforms', () => {
    const servers = binaryAssetConfig.servers as Record<
      string,
      {
        version: string
        assets: Record<
          string,
          { url: string; sha256: string; archive: string; binaryRelativePath: string }
        >
      }
    >
    for (const entry of getLspServerRegistry()) {
      if (entry.acquisition.kind !== 'github-binary') {
        continue
      }
      const pin = servers[entry.id]
      expect(pin, `missing binary pin for ${entry.id}`).toBeDefined()
      // linux-arm64 coverage varies upstream (e.g. clangd); the big three are required.
      for (const platform of ['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64']) {
        const asset = pin?.assets[platform]
        expect(asset, `${entry.id} missing ${platform}`).toBeDefined()
        expect(asset?.sha256).toMatch(SHA256_PATTERN)
        expect(asset?.url).toMatch(/^https:\/\//)
        expect(['tar.gz', 'zip', 'gz', 'none']).toContain(asset?.archive)
        expect(asset?.binaryRelativePath).toBeTruthy()
        if (platform === 'win32-x64') {
          expect(asset?.binaryRelativePath.endsWith('.exe')).toBe(true)
        }
      }
    }
  })

  it('gives every server either args ending in a stdio-style mode or a known default', () => {
    for (const entry of getLspServerRegistry()) {
      if (entry.acquisition.kind === 'node-bundle') {
        const pin = lspNodeBundlePin(entry.acquisition.bundleId)
        const extraArgs = pin?.servers[entry.id]?.extraArgs ?? []
        const args = [...extraArgs, ...(entry.args ?? [])]
        expect(args.length, `${entry.id} has no launch mode args`).toBeGreaterThan(0)
      }
    }
  })
})
