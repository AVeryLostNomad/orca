import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getAdsServerRoot } from './ads-server'

// The web client recomputes the remote-resource root as
// `/${quality ?? 'oss'}-${commit ?? 'dev'}` from the productConfiguration the
// dev server embeds in the page — which is only product.overrides.json plus an
// embedder id. Without `commit` the client requests /oss-dev while the server
// serves /oss-<commit>, so every vscode-remote-resource fetch 404s: color
// themes (the workbench then falls back to its hardcoded web-light theme),
// icon themes, TextMate grammars, and extension media. The server re-reads the
// overrides file per page load, so repairing installed trees in place fixes
// them without an artifact rebuild.
export function repairAdsProductOverrides(root: string = getAdsServerRoot()): void {
  try {
    const product = JSON.parse(readFileSync(join(root, 'product.json'), 'utf8')) as {
      commit?: unknown
      quality?: unknown
    }
    const overridesPath = join(root, 'product.overrides.json')
    const overrides = JSON.parse(readFileSync(overridesPath, 'utf8')) as Record<string, unknown>
    const desired: Record<string, unknown> = {}
    if (typeof product.commit === 'string') {
      desired.commit = product.commit
    }
    if (typeof product.quality === 'string') {
      desired.quality = product.quality
    }
    if (Object.entries(desired).every(([key, value]) => overrides[key] === value)) {
      return
    }
    writeFileSync(overridesPath, `${JSON.stringify({ ...overrides, ...desired }, null, '\t')}\n`)
  } catch {
    // No install yet or an unreadable tree — the spawn path reports that.
  }
}
