import { win32 as pathWin32 } from 'node:path'
import { resolveWindowsGitBashShellPath } from '../git-bash'
import {
  resolveEffectiveWindowsPowerShell,
  type WindowsPowerShellImplementation,
  type WindowsPowerShellShellFamily
} from '../providers/windows-powershell'
import { resolveWindowsPowerShellSpawnChain } from '../providers/windows-powershell-executable'
import {
  configureWindowsShellPathHydration,
  hydrateShellPath,
  mergePathSegments,
  type HydrationResult
} from './hydrate-shell-path'
import { startSpan } from '../observability/tracer'

export type WindowsShellPathHydrationOutcome = {
  shell: string
  durationMs: number
  result: HydrationResult | null
  added: string[]
}

type WindowsShellPathHydrationOptions = {
  configure?: (
    shell: string | null | undefined,
    gitBashPath: string | null,
    fallbackShell: string | null
  ) => void
  hydrate?: () => Promise<HydrationResult>
  merge?: (segments: string[]) => string[]
  resolveGitBashPath?: (shell: string) => string | null
  resolvePowerShellChain?: (family: 'powershell.exe' | 'pwsh.exe') => string[]
  warn?: (error: unknown) => void
  report?: (outcome: WindowsShellPathHydrationOutcome) => void
}

// Why: shell segments go ahead of the inherited PATH, and every bare-name spawn stats them
// synchronously, so a network folder there (Git Bash's `~/bin` on a mapped home) stalls main.
const MAX_REPORTED_OFF_SYSTEM_DRIVE_SEGMENTS = 5

function isOffSystemDriveSegment(segment: string, systemDrive: string): boolean {
  const normalized = segment.trim()
  if (normalized.startsWith('\\\\') || normalized.startsWith('//')) {
    return true
  }
  const drive = /^([a-z]):/i.exec(normalized)?.[1]
  return drive !== undefined && `${drive}:`.toLowerCase() !== systemDrive.toLowerCase()
}

export function reportWindowsShellPathHydration(outcome: WindowsShellPathHydrationOutcome): void {
  const segments = outcome.result?.segments ?? []
  const systemDrive = process.env.SystemDrive ?? 'C:'
  const offSystemDrive = segments
    .map((segment, index) => ({ segment, index }))
    .filter(({ segment }) => isOffSystemDriveSegment(segment, systemDrive))
    .slice(0, MAX_REPORTED_OFF_SYSTEM_DRIVE_SEGMENTS)
    .map(({ segment, index }) => `${index}:${segment}`)
  const span = startSpan('shell_path.hydration', {
    attributes: {
      shell: outcome.shell,
      ok: outcome.result?.ok ?? false,
      failureReason: outcome.result ? outcome.result.failureReason : 'threw',
      durationMs: Math.round(outcome.durationMs),
      prependedSegmentCount: segments.length,
      addedSegmentCount: outcome.added.length,
      offSystemDriveSegments: offSystemDrive.join('; ')
    }
  })
  span.end()
}

export function createWindowsShellPathHydration(options: WindowsShellPathHydrationOptions = {}) {
  const configure = options.configure ?? configureWindowsShellPathHydration
  const hydrate = options.hydrate ?? hydrateShellPath
  const merge = options.merge ?? mergePathSegments
  const resolveGitBashPath = options.resolveGitBashPath ?? resolveWindowsGitBashShellPath
  const resolvePowerShellChain =
    options.resolvePowerShellChain ?? resolveWindowsPowerShellSpawnChain
  const report = options.report ?? reportWindowsShellPathHydration
  const warn =
    options.warn ??
    ((error: unknown) => {
      console.warn('[shell-path] Windows profile hydration failed; using inherited PATH:', error)
    })
  let generation = 0
  let ready = Promise.resolve()
  let configuredShellName = ''

  const setConfiguredShell = (
    shell: string | null | undefined,
    implementation?: WindowsPowerShellImplementation
  ): void => {
    const requestedShell = shell?.trim() || 'powershell.exe'
    const basename = pathWin32.basename(requestedShell).toLowerCase()
    configuredShellName = basename
    const shellFamily: WindowsPowerShellShellFamily =
      basename === 'powershell.exe' || basename === 'pwsh.exe' ? basename : undefined
    const effectivePowerShell = resolveEffectiveWindowsPowerShell({
      shellFamily,
      implementation,
      pwshAvailable: true
    })
    if (!effectivePowerShell) {
      configure(requestedShell, resolveGitBashPath(requestedShell), null)
      return
    }
    const spawnChain = resolvePowerShellChain(effectivePowerShell)
    const profileShell = spawnChain[0] ?? 'cmd.exe'
    const fallbackShell = spawnChain.slice(1).find((candidate) => {
      const candidateBasename = pathWin32.basename(candidate).toLowerCase()
      return candidateBasename === 'powershell.exe' || candidateBasename === 'pwsh.exe'
    })
    configure(profileShell, null, fallbackShell ?? null)
  }

  return {
    configure: (shell, implementation?: WindowsPowerShellImplementation) => {
      generation += 1
      setConfiguredShell(shell, implementation)
    },
    hydrate: (shell, implementation?: WindowsPowerShellImplementation) => {
      generation += 1
      const requestGeneration = generation
      setConfiguredShell(shell, implementation)
      ready = ready.then(async () => {
        if (requestGeneration !== generation) {
          return
        }
        const startedAt = performance.now()
        let result: HydrationResult | null = null
        let added: string[] = []
        try {
          result = await hydrate()
          if (requestGeneration === generation && result.ok) {
            added = merge(result.segments)
          }
        } catch (error) {
          if (requestGeneration === generation) {
            warn(error)
          }
        }
        if (requestGeneration === generation) {
          try {
            report({
              shell: configuredShellName,
              durationMs: performance.now() - startedAt,
              result,
              added
            })
          } catch {
            // Diagnostics must never fail PATH hydration.
          }
        }
      })
      return ready
    },
    whenReady: async () => {
      let pending = ready
      while (true) {
        await pending
        if (pending === ready) {
          return
        }
        pending = ready
      }
    }
  }
}
