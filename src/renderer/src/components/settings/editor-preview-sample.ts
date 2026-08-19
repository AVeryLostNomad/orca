export type EditorPreviewLanguageId = 'typescript' | 'python' | 'markdown'

export type EditorPreviewSample = {
  id: EditorPreviewLanguageId
  label: string
  language: string
  content: string
}

const TYPESCRIPT_SAMPLE = `import { createServer } from 'node:http'

type Route = {
  method: 'GET' | 'POST'
  path: string
  handler: (body: unknown) => Promise<Response>
}

const routes: Route[] = []

/** Register a route; duplicate method+path pairs replace the earlier entry so hot reloads stay idempotent. */
export function route(method: Route['method'], path: string, handler: Route['handler']): void {
  const existing = routes.findIndex((r) => r.method === method && r.path === path)
  if (existing >= 0) {
    routes.splice(existing, 1)
  }
  routes.push({ method, path, handler })
}

route('GET', '/health', async () => new Response(JSON.stringify({ ok: true, uptime: process.uptime() }), { headers: { 'content-type': 'application/json' } }))

const server = createServer((req, res) => {
  const match = routes.find((r) => r.method === req.method && r.path === req.url)
  if (!match) {
    res.writeHead(404)
    res.end()
    return
  }
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ matched: match.path }))
})

server.listen(3000, () => {
  console.log('listening on :3000')
})
`

const PYTHON_SAMPLE = `import asyncio
from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class Task:
    name: str
    priority: int = 0
    created_at: datetime = field(default_factory=datetime.utcnow)

    def __lt__(self, other: "Task") -> bool:
        return self.priority > other.priority


class Scheduler:
    """Runs tasks in priority order, yielding between each so long queues stay responsive."""

    def __init__(self) -> None:
        self._queue: list[Task] = []

    def add(self, name: str, priority: int = 0) -> Task:
        task = Task(name=name, priority=priority)
        self._queue.append(task)
        self._queue.sort()
        return task

    async def drain(self) -> list[str]:
        finished: list[str] = []
        while self._queue:
            task = self._queue.pop(0)
            finished.append(f"{task.name} (p{task.priority}, queued {task.created_at:%H:%M:%S})")
            await asyncio.sleep(0)
        return finished


if __name__ == "__main__":
    scheduler = Scheduler()
    scheduler.add("compile", priority=2)
    scheduler.add("lint")
    print(asyncio.run(scheduler.drain()))
`

const MARKDOWN_SAMPLE = `# Release Notes — 2.4.0

## Highlights

- **Faster diffs**: syntax highlighting now streams in as files parse, so large reviews open immediately instead of blocking on the slowest file.
- New \`--watch\` flag for the CLI.

## Breaking changes

| Setting | Before | After |
| ------- | ------ | ----- |
| \`editor.theme\` | single value | light + dark slots |

\`\`\`bash
orca upgrade && orca doctor
\`\`\`

> Upgrade note: run the doctor once after upgrading; it migrates local settings in place and prints anything it could not translate automatically.

1. Back up your settings
2. Upgrade
3. Verify with \`orca doctor\`
`

export const EDITOR_PREVIEW_SAMPLES: EditorPreviewSample[] = [
  { id: 'typescript', label: 'TypeScript', language: 'typescript', content: TYPESCRIPT_SAMPLE },
  { id: 'python', label: 'Python', language: 'python', content: PYTHON_SAMPLE },
  { id: 'markdown', label: 'Markdown', language: 'markdown', content: MARKDOWN_SAMPLE }
]
