import type {
  CompletionItem,
  CompletionItemDefaults,
  CompletionList,
  Position
} from 'vscode-languageserver-protocol'

/** Flatten a completion response into standalone items, folding in LSP 3.17
 *  `itemDefaults` (servers like Roslyn send the edit range and resolve `data`
 *  once per list) so each item can be converted and resolved on its own. */
export function lspCompletionItemsWithDefaults(
  response: CompletionItem[] | CompletionList,
  allCommitCharacters?: string[]
): CompletionItem[] {
  if (Array.isArray(response)) {
    return allCommitCharacters
      ? response.map((item) => ({
          ...item,
          commitCharacters: item.commitCharacters ?? allCommitCharacters
        }))
      : response
  }
  const defaults: CompletionItemDefaults = response.itemDefaults ?? {}
  return response.items.map((item) => {
    const merged: CompletionItem = {
      ...item,
      commitCharacters: item.commitCharacters ?? defaults.commitCharacters ?? allCommitCharacters,
      insertTextFormat: item.insertTextFormat ?? defaults.insertTextFormat,
      insertTextMode: item.insertTextMode ?? defaults.insertTextMode,
      data: item.data ?? defaults.data
    }
    if (!item.textEdit && defaults.editRange) {
      const newText = item.textEditText ?? item.insertText ?? item.label
      merged.textEdit =
        'insert' in defaults.editRange
          ? { newText, insert: defaults.editRange.insert, replace: defaults.editRange.replace }
          : { newText, range: defaults.editRange }
    }
    return merged
  })
}

/** Where items without their own `textEdit` start replacing: Monaco filters them by the text
 *  between this position and the caret. */
export function completionListReplaceStart(list: CompletionList): Position | undefined {
  const editRange = list.itemDefaults?.editRange
  if (!editRange) {
    return undefined
  }
  return 'insert' in editRange ? editRange.insert.start : editRange.start
}

function isCaseInsensitiveSubsequence(pattern: string, text: string): boolean {
  let matched = 0
  for (let index = 0; index < text.length && matched < pattern.length; index++) {
    if (text[index].toLowerCase() === pattern[matched]) {
      matched++
    }
  }
  return matched === pattern.length
}

/**
 * Shrinks a truncated (`isIncomplete`) list to the items Monaco could still show for `typedPrefix`:
 * its fuzzy filter only keeps case-insensitive subsequence matches, and backspacing re-queries.
 * When the server ranks every match ahead of non-matches before truncating (Roslyn caps lists at
 * 1000 and pads them with non-matching items), a non-matching tail proves all matches arrived, so
 * the list is complete for this word and Monaco can filter locally instead of re-querying per key.
 */
export function narrowIncompleteCompletionList(
  list: CompletionList,
  typedPrefix: string,
  serverRanksMatchesFirst: boolean
): CompletionList {
  if (!list.isIncomplete || typedPrefix.length === 0) {
    return list
  }
  const pattern = typedPrefix.toLowerCase()
  const matches = (item: CompletionItem): boolean =>
    isCaseInsensitiveSubsequence(pattern, item.filterText ?? item.label)
  const last = list.items.at(-1)
  // Items carrying their own edit range are filtered against a different span; keep them.
  const items = list.items.filter((item) => item.textEdit !== undefined || matches(item))
  const tailProvesComplete =
    serverRanksMatchesFirst && last !== undefined && last.textEdit === undefined && !matches(last)
  return { ...list, items, isIncomplete: !tailProvesComplete }
}
