export type GitAvailability = 'checking' | 'available' | 'unavailable' | 'unknown'

export function withCreateProjectTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out')), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timeout)
        resolve(value)
      },
      (error) => {
        clearTimeout(timeout)
        reject(error)
      }
    )
  })
}

const CREATE_PROJECT_PARENT_STORAGE_PREFIX = 'orca.createProject.lastParent.'

type CreateProjectParentStorage = Pick<Storage, 'getItem' | 'setItem'>

function getCreateProjectParentStorage(): CreateProjectParentStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function getCreateProjectParentTargetKey({
  runtimeEnvironmentId,
  sshTargetId
}: {
  runtimeEnvironmentId?: string | null
  sshTargetId?: string | null
}): string {
  const runtimeId = runtimeEnvironmentId?.trim()
  if (runtimeId) {
    return `runtime:${runtimeId}`
  }
  const sshId = sshTargetId?.trim()
  return sshId ? `ssh:${sshId}` : 'local'
}

export function readLastCreateProjectParent(
  targetKey: string,
  storage: CreateProjectParentStorage | null = getCreateProjectParentStorage()
): string | null {
  try {
    return storage?.getItem(`${CREATE_PROJECT_PARENT_STORAGE_PREFIX}${targetKey}`)?.trim() || null
  } catch {
    return null
  }
}

export function rememberCreateProjectParent(
  targetKey: string,
  parentPath: string,
  storage: CreateProjectParentStorage | null = getCreateProjectParentStorage()
): void {
  const parent = parentPath.trim()
  if (!parent) {
    return
  }
  try {
    storage?.setItem(`${CREATE_PROJECT_PARENT_STORAGE_PREFIX}${targetKey}`, parent)
  } catch {
    // The successful create remains valid when browser storage is unavailable.
  }
}

function pathSeparatorFor(pathValue: string): '/' | '\\' {
  return pathValue.includes('\\') ? '\\' : '/'
}

function trimTrailingSeparators(pathValue: string): string {
  const trimmed = pathValue.replace(/[\\/]+$/, '')
  if (trimmed === '' && pathValue.startsWith('/')) {
    return '/'
  }
  if (/^[A-Za-z]:$/.test(trimmed)) {
    return `${trimmed}${pathSeparatorFor(pathValue)}`
  }
  return trimmed
}

export function joinCreateProjectPath(parentPath: string, childName: string): string {
  const parent = trimTrailingSeparators(parentPath.trim())
  const child = childName.trim().replace(/^[\\/]+/, '')
  if (!parent || !child) {
    return parent || child
  }
  const separator = pathSeparatorFor(parent)
  if (parent === '/' || /^[A-Za-z]:[\\/]$/.test(parent)) {
    return `${parent}${child}`
  }
  return `${parent}${separator}${child}`
}

export function getDefaultCreateProjectParent(homeDir: string): string {
  const trimmedHomeDir = trimTrailingSeparators(homeDir.trim())
  if (!trimmedHomeDir) {
    return ''
  }
  return joinCreateProjectPath(joinCreateProjectPath(trimmedHomeDir, 'orca'), 'projects')
}

export function getCreateProjectDefaultParentAutoFill({
  step,
  createParent,
  activeRuntimeEnvironmentId,
  defaultParent,
  createStepAutoFilled
}: {
  step: string
  createParent: string
  activeRuntimeEnvironmentId: string | null | undefined
  defaultParent?: string
  createStepAutoFilled: boolean
}): { parent: string } | null {
  if (step !== 'create' || createStepAutoFilled || createParent) {
    return null
  }
  if (activeRuntimeEnvironmentId?.trim()) {
    return null
  }
  const parent = defaultParent ?? ''
  if (!parent) {
    return null
  }
  return { parent }
}

export function formatCreateProjectParentSummary({
  parent,
  defaultParent,
  runtimeEnvironmentId,
  isRemoteHost,
  missingLocationLabel = 'location not selected',
  missingServerLocationLabel = 'host folder not selected'
}: {
  parent: string
  defaultParent: string
  runtimeEnvironmentId?: string | null
  isRemoteHost?: boolean
  missingLocationLabel?: string
  missingServerLocationLabel?: string
}): string {
  const trimmedParent = parent.trim()
  if (!trimmedParent) {
    return runtimeEnvironmentId || isRemoteHost ? missingServerLocationLabel : missingLocationLabel
  }
  if (defaultParent && trimmedParent === defaultParent && !runtimeEnvironmentId && !isRemoteHost) {
    return '~/orca/projects'
  }
  return trimmedParent
}
