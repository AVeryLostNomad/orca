import type * as Monaco from 'monaco-editor'

type MonacoModule = Pick<typeof Monaco, 'languages'>

type CSharpSnippet = { prefix: string; description: string; body: string }

// Roslyn's LSP sends `for`/`foreach`/... as bare keywords, so the editor supplies the scaffolds
// Visual Studio and Rider expand. Tab stops use Monaco snippet syntax; tabs follow model indentation.
export const CSHARP_SNIPPETS: readonly CSharpSnippet[] = [
  {
    prefix: 'class',
    description: 'Class',
    body: 'public class ${1:${TM_FILENAME_BASE}}\n{\n\t$0\n}'
  },
  {
    prefix: 'interface',
    description: 'Interface',
    body: 'public interface ${1:IName}\n{\n\t$0\n}'
  },
  { prefix: 'struct', description: 'Struct', body: 'public struct ${1:Name}\n{\n\t$0\n}' },
  { prefix: 'enum', description: 'Enum', body: 'public enum ${1:Name}\n{\n\t$0\n}' },
  { prefix: 'record', description: 'Record', body: 'public record ${1:Name}(${2});' },
  {
    prefix: 'ctor',
    description: 'Constructor',
    body: 'public ${1:${TM_FILENAME_BASE}}(${2})\n{\n\t$0\n}'
  },
  {
    prefix: 'prop',
    description: 'Auto property',
    body: 'public ${1:int} ${2:Name} { get; set; }$0'
  },
  {
    prefix: 'propg',
    description: 'Auto property with private setter',
    body: 'public ${1:int} ${2:Name} { get; private set; }$0'
  },
  {
    prefix: 'propfull',
    description: 'Property with backing field',
    body: 'private ${1:int} ${2:name};\n\npublic $1 ${3:Name}\n{\n\tget => $2;\n\tset => $2 = value;\n}$0'
  },
  {
    prefix: 'for',
    description: 'for loop',
    body: 'for (int ${1:i} = 0; $1 < ${2:length}; $1++)\n{\n\t$0\n}'
  },
  {
    prefix: 'forr',
    description: 'Reverse for loop',
    body: 'for (int ${1:i} = ${2:length} - 1; $1 >= 0; $1--)\n{\n\t$0\n}'
  },
  {
    prefix: 'foreach',
    description: 'foreach loop',
    body: 'foreach (var ${1:item} in ${2:collection})\n{\n\t$0\n}'
  },
  { prefix: 'while', description: 'while loop', body: 'while (${1:true})\n{\n\t$0\n}' },
  { prefix: 'do', description: 'do...while loop', body: 'do\n{\n\t$0\n} while (${1:true});' },
  { prefix: 'if', description: 'if statement', body: 'if (${1:true})\n{\n\t$0\n}' },
  { prefix: 'else', description: 'else statement', body: 'else\n{\n\t$0\n}' },
  {
    prefix: 'switch',
    description: 'switch statement',
    body: 'switch (${1:value})\n{\n\tcase ${2:0}:\n\t\t$0\n\t\tbreak;\n\tdefault:\n\t\tbreak;\n}'
  },
  {
    prefix: 'try',
    description: 'try...catch',
    body: 'try\n{\n\t$0\n}\ncatch (${1:System.Exception} ${2:ex})\n{\n\tthrow;\n}'
  },
  { prefix: 'tryf', description: 'try...finally', body: 'try\n{\n\t$0\n}\nfinally\n{\n\t\n}' },
  { prefix: 'using', description: 'using statement', body: 'using (${1:resource})\n{\n\t$0\n}' },
  { prefix: 'lock', description: 'lock statement', body: 'lock (${1:this})\n{\n\t$0\n}' },
  { prefix: 'cw', description: 'Console.WriteLine', body: 'System.Console.WriteLine($0);' },
  { prefix: '#region', description: 'Region', body: '#region ${1:Name}\n$0\n#endregion' }
]

/** Snippet body as the code it expands to with default placeholders (for the details pane). */
export function csharpSnippetPreview(body: string): string {
  let text = body.replace(/\$\{TM_FILENAME_BASE\}/g, 'ClassName')
  const defaults: Record<string, string> = {}
  // Innermost placeholders first, so nested defaults resolve before their parents.
  for (let previous = ''; previous !== text;) {
    previous = text
    text = text.replace(/\$\{(\d+):([^{}$]*)\}/g, (_match, index: string, value: string) => {
      defaults[index] = value
      return value
    })
  }
  return text.replace(/\$\{?(\d+)\}?/g, (_match, index: string) => defaults[index] ?? '')
}

/** Snippets belong where statements and members start: not after `.`, nor in a comment or string. */
export function csharpSnippetsAllowedAfter(linePrefix: string): boolean {
  if (/\.\s*$/.test(linePrefix)) {
    return false
  }
  let inString = false
  for (let index = 0; index < linePrefix.length; index++) {
    const ch = linePrefix[index]
    if (inString) {
      if (ch === '\\') {
        index++
      } else if (ch === '"') {
        inString = false
      }
    } else if (ch === '"') {
      inString = true
    } else if (ch === '/' && linePrefix[index + 1] === '/') {
      return false
    }
  }
  return !inString
}

export function registerCSharpSnippets(monaco: MonacoModule): void {
  monaco.languages.registerCompletionItemProvider('csharp', {
    provideCompletionItems(model, position) {
      const line = model.getLineContent(position.lineNumber)
      const word = model.getWordUntilPosition(position)
      // `#region` starts at the `#`, which Monaco's word pattern excludes.
      const startColumn =
        line[word.startColumn - 2] === '#' ? word.startColumn - 1 : word.startColumn
      if (!csharpSnippetsAllowedAfter(line.slice(0, startColumn - 1))) {
        return null
      }
      const range = {
        startLineNumber: position.lineNumber,
        startColumn,
        endLineNumber: position.lineNumber,
        endColumn: word.endColumn
      }
      return {
        suggestions: CSHARP_SNIPPETS.map((snippet) => ({
          label: { label: snippet.prefix, description: snippet.description },
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: snippet.body,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: { value: `\`\`\`csharp\n${csharpSnippetPreview(snippet.body)}\n\`\`\`` },
          // Roslyn sortText is a numeric index, so an identical keyword still lists first.
          sortText: snippet.prefix,
          range
        }))
      }
    }
  })
}
