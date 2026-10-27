export function oppositeViewMode(mode: 'terminal' | 'chat'): 'terminal' | 'chat' {
  return mode === 'chat' ? 'terminal' : 'chat'
}
