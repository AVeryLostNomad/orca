import type {
  CompletionItem,
  CompletionItemDefaults,
  CompletionList
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
