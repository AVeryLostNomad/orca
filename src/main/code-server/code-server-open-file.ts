import { request } from 'node:http'
import { existsSync } from 'node:fs'
// code-server's session registry socket (shared with the manager, which passes
// it via --session-socket on Windows). Mirrors code-server's own CLI flow
// (openInExistingInstance): GET /session resolves the attached workbench's
// VS Code IPC pipe, and the open command is POSTed to that pipe — the
// registry socket itself does not accept open commands.
import { getCodeServerSessionSocketPath } from './code-server-ipc-path'

function requestOverSocket(options: {
  socketPath: string
  path: string
  method: 'GET' | 'POST'
  body?: string
}): Promise<string | null> {
  return new Promise((resolve) => {
    const req = request(
      { socketPath: options.socketPath, path: options.path, method: options.method },
      (response) => {
        let raw = ''
        response.setEncoding('utf8')
        response.on('data', (chunk: string) => {
          raw += chunk
        })
        response.on('end', () => {
          resolve(response.statusCode === 200 ? raw : null)
        })
      }
    )
    req.on('error', () => resolve(null))
    req.setTimeout(3_000, () => {
      req.destroy()
      resolve(null)
    })
    if (options.body !== undefined) {
      req.write(options.body)
    }
    req.end()
  })
}

// VS Code's CLI server runs the payload through URI.parse, which reads a raw
// `C:\...` drive letter as the URI scheme and silently drops the open. Bare
// POSIX paths only survive because scheme-less strings get promoted to file:.
// Mirror server-cli.js and always send a real file URI. URI.parse
// percent-decodes components, so only %, ? and # need encoding.
export function toFileOpenUri(
  absolutePath: string,
  platform: NodeJS.Platform = process.platform
): string {
  const encoded = absolutePath.replace(/%/g, '%25').replace(/\?/g, '%3F').replace(/#/g, '%23')
  if (platform === 'win32') {
    if (/^[A-Za-z]:[\\/]/.test(encoded)) {
      return `file:///${encoded.replace(/\\/g, '/')}`
    }
    if (encoded.startsWith('\\\\')) {
      // UNC (\\wsl.localhost\...) → file://wsl.localhost/... (host as authority)
      return `file:${encoded.replace(/\\/g, '/')}`
    }
  }
  return `file://${encoded}`
}

async function resolveWorkbenchSocketPath(absolutePath: string): Promise<string | null> {
  const raw = await requestOverSocket({
    socketPath: getCodeServerSessionSocketPath(),
    path: `/session?filePath=${encodeURIComponent(absolutePath)}`,
    method: 'GET'
  })
  if (!raw) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    const socketPath = (parsed as { socketPath?: unknown }).socketPath
    return typeof socketPath === 'string' && socketPath ? socketPath : null
  } catch {
    return null
  }
}

/**
 * Open a file in the running code-server's active workbench session.
 * Resolves false when no attached session is found or the request fails,
 * so callers can fall back to Orca's own editor.
 */
export async function openFileInCodeServer(absolutePath: string): Promise<boolean> {
  // existsSync on \\.\pipe\ names is unreliable; on Windows rely on the
  // connect error / 3s timeout in requestOverSocket instead.
  if (process.platform !== 'win32' && !existsSync(getCodeServerSessionSocketPath())) {
    return false
  }
  const workbenchSocketPath = await resolveWorkbenchSocketPath(absolutePath)
  if (!workbenchSocketPath) {
    return false
  }
  const payload = JSON.stringify({
    type: 'open',
    folderURIs: [],
    fileURIs: [toFileOpenUri(absolutePath)],
    forceReuseWindow: true,
    gotoLineMode: true
  })
  const response = await requestOverSocket({
    socketPath: workbenchSocketPath,
    path: '/',
    method: 'POST',
    body: payload
  })
  return response !== null
}
