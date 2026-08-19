export type AppThemeSource = {
  type: 'light' | 'dark'
  colors?: Record<string, string>
  /** Shiki top-level bg/fg fallbacks (bundled themes carry them). */
  bg?: string
  fg?: string
}

type Rgba = { r: number; g: number; b: number; a: number }

export function parseHex(value: string | undefined): Rgba | undefined {
  if (!value) {
    return undefined
  }
  const hex = value.trim()
  if (!hex.startsWith('#')) {
    return undefined
  }
  const body = hex.slice(1)
  const expand = (s: string): string =>
    s
      .split('')
      .map((c) => c + c)
      .join('')
  const full =
    body.length === 3 || body.length === 4
      ? expand(body)
      : body.length === 6 || body.length === 8
        ? body
        : undefined
  if (!full || !/^[0-9a-fA-F]+$/.test(full)) {
    return undefined
  }
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
    a: full.length === 8 ? Number.parseInt(full.slice(6, 8), 16) / 255 : 1
  }
}

export function toHex(color: Rgba): string {
  const channel = (n: number): string =>
    Math.round(Math.max(0, Math.min(255, n)))
      .toString(16)
      .padStart(2, '0')
  const base = `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`
  return color.a >= 1 ? base : `${base}${channel(color.a * 255)}`
}

export function compositeOver(fg: Rgba, bg: Rgba): Rgba {
  const a = fg.a + bg.a * (1 - fg.a)
  if (a === 0) {
    return { r: 0, g: 0, b: 0, a: 0 }
  }
  const blend = (f: number, b: number): number => (f * fg.a + b * bg.a * (1 - fg.a)) / a
  return { r: blend(fg.r, bg.r), g: blend(fg.g, bg.g), b: blend(fg.b, bg.b), a }
}

function mix(fg: Rgba, bg: Rgba, fgWeight: number): Rgba {
  const t = Math.max(0, Math.min(1, fgWeight))
  return {
    r: fg.r * t + bg.r * (1 - t),
    g: fg.g * t + bg.g * (1 - t),
    b: fg.b * t + bg.b * (1 - t),
    a: 1
  }
}

function relativeLuminance(color: Rgba): number {
  const linear = (channel: number): number => {
    const c = channel / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b)
}

export function contrastRatio(a: Rgba, b: Rgba): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 }
const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 }

/** Returns `preferred` when it clears `min` contrast on `surface`, else white/black — whichever reads better. */
function readable(preferred: Rgba | undefined, surface: Rgba, min: number): Rgba {
  if (preferred && contrastRatio(compositeOver(preferred, surface), surface) >= min) {
    return preferred
  }
  return contrastRatio(WHITE, surface) >= contrastRatio(BLACK, surface) ? WHITE : BLACK
}

const MIN_PAIR_CONTRAST = 3

export function buildAppThemeTokenOverrides(
  theme: AppThemeSource
): Record<string, string> | undefined {
  const colors = theme.colors ?? {}
  const pick = (...keys: string[]): Rgba | undefined => {
    for (const key of keys) {
      const parsed = parseHex(colors[key])
      if (parsed) {
        return parsed
      }
    }
    return undefined
  }

  const baseBg = pick('editor.background') ?? parseHex(theme.bg)
  const declaredFg = pick('editor.foreground', 'foreground') ?? parseHex(theme.fg)
  if (!baseBg && !declaredFg) {
    return undefined
  }
  const bg = baseBg ?? (theme.type === 'dark' ? { ...BLACK } : { ...WHITE })
  const fg = readable(declaredFg, bg, MIN_PAIR_CONTRAST)

  const out: Record<string, string> = {}
  const set = (token: string, color: Rgba | undefined): Rgba | undefined => {
    if (color) {
      out[token] = toHex(color)
    }
    return color
  }
  // Emits `${token}-foreground` guarded to stay legible on `surface`.
  const setFgFor = (token: string, preferred: Rgba | undefined, surface: Rgba): void => {
    const flattened = compositeOver(surface, bg)
    set(`${token}-foreground`, readable(preferred, flattened, MIN_PAIR_CONTRAST))
  }

  set('--background', bg)
  set('--foreground', fg)

  const card =
    pick('editorWidget.background', 'sideBarSectionHeader.background') ?? mix(fg, bg, 0.04)
  set('--card', card)
  setFgFor('--card', pick('editorWidget.foreground') ?? fg, card)

  const popover = pick('menu.background', 'dropdown.background', 'editorWidget.background') ?? card
  set('--popover', popover)
  setFgFor('--popover', pick('menu.foreground', 'dropdown.foreground') ?? fg, popover)

  const primary = pick('button.background') ?? mix(fg, bg, 0.88)
  set('--primary', primary)
  setFgFor('--primary', pick('button.foreground'), primary)

  const secondary = pick('button.secondaryBackground') ?? mix(fg, bg, 0.08)
  set('--secondary', secondary)
  setFgFor('--secondary', pick('button.secondaryForeground') ?? fg, secondary)

  const muted = mix(fg, bg, 0.07)
  set('--muted', muted)
  set(
    '--muted-foreground',
    pick('descriptionForeground', 'disabledForeground') ?? mix(fg, bg, 0.62)
  )

  const accent = pick('list.hoverBackground') ?? mix(fg, bg, 0.09)
  set('--accent', accent)
  setFgFor('--accent', pick('list.hoverForeground') ?? fg, accent)

  const destructive = pick('errorForeground', 'editorError.foreground')
  if (destructive) {
    set('--destructive', destructive)
    setFgFor('--destructive', undefined, destructive)
  }

  set('--border', pick('panel.border', 'editorGroup.border', 'contrastBorder') ?? mix(fg, bg, 0.1))
  set('--input', pick('input.background') ?? mix(fg, bg, 0.12))
  const ring = pick('focusBorder') ?? mix(fg, bg, 0.45)
  set('--ring', ring)

  const sidebar = pick('sideBar.background') ?? mix(fg, bg, 0.03)
  const sidebarFg = readable(
    pick('sideBar.foreground') ?? fg,
    compositeOver(sidebar, bg),
    MIN_PAIR_CONTRAST
  )
  set('--sidebar', sidebar)
  set('--sidebar-foreground', sidebarFg)
  set('--sidebar-primary', primary)
  out['--sidebar-primary-foreground'] = out['--primary-foreground']
  set('--sidebar-accent', accent)
  setFgFor('--sidebar-accent', pick('list.hoverForeground') ?? sidebarFg, accent)
  set('--sidebar-border', pick('sideBar.border') ?? parseHex(out['--border']))
  set('--sidebar-ring', ring)

  const worktreeSidebar = pick('activityBar.background', 'sideBar.background') ?? mix(fg, bg, 0.06)
  const worktreeSidebarFg = readable(
    pick('activityBar.foreground', 'sideBar.foreground') ?? fg,
    compositeOver(worktreeSidebar, bg),
    MIN_PAIR_CONTRAST
  )
  set('--worktree-sidebar', worktreeSidebar)
  set('--worktree-sidebar-foreground', worktreeSidebarFg)
  const worktreeAccent =
    pick('list.activeSelectionBackground') ?? mix(worktreeSidebarFg, worktreeSidebar, 0.1)
  set('--worktree-sidebar-accent', worktreeAccent)
  setFgFor(
    '--worktree-sidebar-accent',
    pick('list.activeSelectionForeground') ?? worktreeSidebarFg,
    worktreeAccent
  )
  set(
    '--worktree-sidebar-border',
    pick('activityBar.border', 'sideBar.border') ?? parseHex(out['--border'])
  )
  set('--worktree-sidebar-ring', ring)

  const gitDecorations: [string, string][] = [
    ['--git-decoration-added', 'gitDecoration.addedResourceForeground'],
    ['--git-decoration-modified', 'gitDecoration.modifiedResourceForeground'],
    ['--git-decoration-deleted', 'gitDecoration.deletedResourceForeground'],
    ['--git-decoration-renamed', 'gitDecoration.renamedResourceForeground'],
    ['--git-decoration-untracked', 'gitDecoration.untrackedResourceForeground'],
    ['--git-decoration-copied', 'gitDecoration.renamedResourceForeground'],
    ['--git-decoration-ignored', 'gitDecoration.ignoredResourceForeground']
  ]
  for (const [token, key] of gitDecorations) {
    set(token, pick(key))
  }

  return out
}
