import { request } from 'node:http'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { getCodeServerUserDataDir } from './code-server-paths'

// code-server's session registry socket. Mirrors its own CLI flow
// (openInExistingInstance): GET /session resolves the attached workbench's
// VS Code IPC pipe, and the open command is POSTed to that pipe — the
// registry socket itself does not accept open commands.
function getCodeServerSessionSocketPath(): string {
  return join(getCodeServerUserDataDir(), 'code-server-ipc.sock')
}

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
  if (!existsSync(getCodeServerSessionSocketPath())) {
    return false
  }
  const workbenchSocketPath = await resolveWorkbenchSocketPath(absolutePath)
  if (!workbenchSocketPath) {
    return false
  }
  const payload = JSON.stringify({
    type: 'open',
    folderURIs: [],
    fileURIs: [absolutePath],
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
