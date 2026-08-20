import { LANGUAGE_PROFILES } from './content-language-signal-profiles'

export type ContentLanguageDetection = {
  /** Monaco language id (matches EXT_TO_LANGUAGE values in language-detect.ts). */
  language: string
  /** Extension (with dot) whose detectLanguage() result is `language`. */
  extension: string
}

// Why: pasted snippets rarely need more; a bounded scan keeps detection O(1) on huge pastes.
const MAX_DETECT_CHARS = 8000
const MIN_SCORE = 6
const MIN_MARGIN = 2
const SIGNAL_COUNT_CAP = 3

// Curly-brace cousins where a shared-signal near-tie should fall back to the
// more general language instead of aborting detection.
const RELATED_LANGUAGE_FALLBACK: Record<string, string> = {
  typescript: 'javascript',
  cpp: 'c'
}

const SHEBANG_LANGUAGES: [RegExp, string][] = [
  [/^#!.*\b(?:bash|sh|zsh)\b/, 'shell'],
  [/^#!.*\bpython\d?\b/, 'python'],
  [/^#!.*\bnode\b/, 'javascript'],
  [/^#!.*\bruby\b/, 'ruby'],
  [/^#!.*\bpwsh\b/, 'powershell']
]

function extensionForLanguage(language: string): string | null {
  return LANGUAGE_PROFILES.find((profile) => profile.language === language)?.extension ?? null
}

function countMatches(text: string, pattern: RegExp): number {
  if (!pattern.global) {
    return pattern.test(text) ? 1 : 0
  }
  pattern.lastIndex = 0
  let count = 0
  while (count < SIGNAL_COUNT_CAP && pattern.exec(text) !== null) {
    count += 1
    if (pattern.lastIndex === 0) {
      break
    }
  }
  return count
}

function detectJson(text: string): boolean {
  const first = text[0]
  if (first !== '{' && first !== '[') {
    return false
  }
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null
  } catch {
    return false
  }
}

/**
 * Best-effort language guess from raw text (no filename), for scratch-file
 * paste/typing detection. Returns null when no language clearly wins, so
 * callers can safely keep plaintext instead of mislabeling.
 */
export function detectLanguageFromContent(content: string): ContentLanguageDetection | null {
  const text = content.slice(0, MAX_DETECT_CHARS).trim()
  if (text.length < 12) {
    return null
  }

  if (detectJson(text)) {
    return { language: 'json', extension: '.json' }
  }

  for (const [pattern, language] of SHEBANG_LANGUAGES) {
    if (pattern.test(text)) {
      return { language, extension: extensionForLanguage(language)! }
    }
  }

  const scored = LANGUAGE_PROFILES.map((profile) => {
    let score = 0
    for (const signal of profile.signals) {
      score += signal.weight * countMatches(text, signal.pattern)
    }
    return { profile, score }
  }).sort((left, right) => right.score - left.score)

  const [best, runnerUp] = scored
  if (!best || best.score < MIN_SCORE) {
    return null
  }
  if (runnerUp && best.score - runnerUp.score < MIN_MARGIN) {
    if (RELATED_LANGUAGE_FALLBACK[best.profile.language] === runnerUp.profile.language) {
      // A dead heat between e.g. typescript/javascript means no TS-only
      // signals fired — the general cousin is the honest answer.
      return best.score > runnerUp.score
        ? { language: best.profile.language, extension: best.profile.extension }
        : { language: runnerUp.profile.language, extension: runnerUp.profile.extension }
    }
    return null
  }
  return { language: best.profile.language, extension: best.profile.extension }
}
