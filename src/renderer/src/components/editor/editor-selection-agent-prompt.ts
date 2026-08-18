export type EditorSelectionAgentPromptArgs = {
  question: string
  relativePath: string
  startLine: number
  endLine: number
  language: string
  selectedText: string
}

function fenceFor(code: string): string {
  // A selection containing ``` needs a longer fence to stay one code block.
  let longest = 0
  for (const match of code.matchAll(/`{3,}/g)) {
    longest = Math.max(longest, match[0].length)
  }
  return '`'.repeat(Math.max(3, longest + 1))
}

export function buildEditorSelectionAgentPrompt(args: EditorSelectionAgentPromptArgs): string {
  const range =
    args.endLine > args.startLine ? `${args.startLine}-${args.endLine}` : `${args.startLine}`
  const code = args.selectedText.replace(/\n$/, '')
  const fence = fenceFor(code)
  const language = args.language === 'plaintext' ? '' : args.language
  const question = args.question.trim()
  const sections = [
    ...(question ? [question] : []),
    `Context — ${args.relativePath}:${range}`,
    `${fence}${language}\n${code}\n${fence}`
  ]
  return sections.join('\n\n')
}
