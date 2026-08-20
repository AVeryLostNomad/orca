export type LanguageSignal = { pattern: RegExp; weight: number }

export type LanguageProfile = {
  language: string
  extension: string
  signals: LanguageSignal[]
}

const JS_SIGNALS: LanguageSignal[] = [
  { pattern: /\b(?:const|let)\s+\w+\s*=/g, weight: 2 },
  { pattern: /=>\s*[{(\w]/g, weight: 2 },
  { pattern: /\bfunction\s*\w*\s*\(/g, weight: 2 },
  { pattern: /\bimport\s+[\w{},*\s]+\s+from\s+['"]/g, weight: 3 },
  { pattern: /\brequire\(['"]/g, weight: 3 },
  { pattern: /\bmodule\.exports\b/g, weight: 3 },
  { pattern: /\bconsole\.(?:log|error|warn)\(/g, weight: 2 },
  { pattern: /\bexport\s+(?:default|const|function|class)\b/g, weight: 2 },
  { pattern: /\bawait\s+\w/g, weight: 1 },
  { pattern: /===|!==/g, weight: 1 }
]

const C_SIGNALS: LanguageSignal[] = [
  { pattern: /^#include\s*<[^>]+>/gm, weight: 3 },
  { pattern: /\bint\s+main\s*\(/g, weight: 2 },
  { pattern: /\b(?:printf|malloc|free|memcpy)\s*\(/g, weight: 3 },
  { pattern: /\bstruct\s+\w+\s*\{/g, weight: 1 },
  { pattern: /\b(?:size_t|uint\d+_t|int\d+_t)\b/g, weight: 2 }
]

export const LANGUAGE_PROFILES: LanguageProfile[] = [
  {
    language: 'sql',
    extension: '.sql',
    signals: [
      { pattern: /\bselect\b[\s\S]{0,300}?\bfrom\b/gi, weight: 4 },
      {
        pattern:
          /\b(?:insert\s+into|update\s+\w+\s+set|delete\s+from|create\s+(?:or\s+replace\s+)?(?:table|view|index|function|procedure)|alter\s+table|drop\s+table|truncate\s+table)\b/gi,
        weight: 4
      },
      {
        pattern: /\b(?:where|group\s+by|order\s+by|having|limit|union\s+all)\b/gi,
        weight: 2
      },
      { pattern: /\b(?:inner|left|right|outer|cross)\s+join\b/gi, weight: 3 },
      { pattern: /\b(?:varchar|nvarchar|primary\s+key|foreign\s+key|not\s+null)\b/gi, weight: 2 },
      { pattern: /^\s*--\s/gm, weight: 1 }
    ]
  },
  {
    language: 'go',
    extension: '.go',
    signals: [
      { pattern: /^package\s+\w+$/m, weight: 4 },
      { pattern: /\bfunc\s+(?:\(\w+\s+\*?\w+\)\s+)?\w+\s*\(/g, weight: 3 },
      { pattern: /:=/g, weight: 2 },
      { pattern: /^import\s+\(/m, weight: 3 },
      { pattern: /\bfmt\.\w+\(/g, weight: 3 },
      { pattern: /\b(?:defer|goroutine|chan\s+\w|go\s+func)\b/g, weight: 2 },
      { pattern: /\berr\s*!=\s*nil\b/g, weight: 3 }
    ]
  },
  {
    language: 'typescript',
    extension: '.ts',
    signals: [
      ...JS_SIGNALS,
      { pattern: /\binterface\s+\w+\s*(?:extends\s+\w+\s*)?\{/g, weight: 3 },
      { pattern: /\btype\s+\w+\s*=/g, weight: 3 },
      { pattern: /:\s*(?:string|number|boolean|void|unknown|never|any)\b/g, weight: 3 },
      { pattern: /\benum\s+\w+\s*\{/g, weight: 2 },
      { pattern: /\bas\s+const\b/g, weight: 2 },
      { pattern: /\w+\?\s*:/g, weight: 1 },
      { pattern: /\bimplements\s+\w+/g, weight: 2 }
    ]
  },
  { language: 'javascript', extension: '.js', signals: JS_SIGNALS },
  {
    language: 'python',
    extension: '.py',
    signals: [
      { pattern: /^\s*def\s+\w+\s*\([^)]*\)\s*(?:->\s*[\w[\]., ]+)?:/gm, weight: 4 },
      { pattern: /^\s*class\s+\w+(?:\([^)]*\))?\s*:/gm, weight: 3 },
      { pattern: /^from\s+[\w.]+\s+import\s+/gm, weight: 3 },
      { pattern: /^import\s+\w+(?:\s*,\s*\w+)*\s*$/gm, weight: 2 },
      { pattern: /\bself\./g, weight: 2 },
      { pattern: /^\s*(?:elif|except\b.*|finally)\s*.*:/gm, weight: 3 },
      { pattern: /\b(?:None|True|False)\b/g, weight: 1 },
      { pattern: /^if\s+__name__\s*==/m, weight: 4 },
      { pattern: /\bprint\(/g, weight: 1 },
      { pattern: /f['"][^'"]*\{[^}]+\}/g, weight: 2 }
    ]
  },
  {
    language: 'rust',
    extension: '.rs',
    signals: [
      { pattern: /\b(?:pub\s+)?fn\s+\w+\s*(?:<[^>]*>)?\s*\(/g, weight: 3 },
      { pattern: /\blet\s+mut\s+\w+/g, weight: 3 },
      { pattern: /\buse\s+(?:std|crate|super)::/g, weight: 4 },
      { pattern: /\b(?:impl|trait)\s+\w+/g, weight: 3 },
      { pattern: /\b(?:println!|format!|vec!)\(/g, weight: 3 },
      { pattern: /->\s*(?:Result|Option|Self|&?\w+)\s*[{<]/g, weight: 2 },
      { pattern: /\bmatch\s+\w+\s*\{/g, weight: 2 },
      { pattern: /&(?:mut\s+)?self\b/g, weight: 3 }
    ]
  },
  {
    language: 'java',
    extension: '.java',
    signals: [
      { pattern: /^import\s+java(?:x)?\./gm, weight: 4 },
      { pattern: /\bpublic\s+(?:static\s+)?(?:final\s+)?(?:class|void|int|String)\b/g, weight: 3 },
      { pattern: /\bSystem\.(?:out|err)\.print/g, weight: 3 },
      { pattern: /\b@(?:Override|Test|Autowired)\b/g, weight: 3 },
      { pattern: /\bprivate\s+(?:final\s+)?\w+\s+\w+\s*;/g, weight: 2 },
      { pattern: /\bnew\s+\w+(?:<[^>]*>)?\s*\(/g, weight: 1 }
    ]
  },
  {
    language: 'csharp',
    extension: '.cs',
    signals: [
      { pattern: /^using\s+System(?:\.\w+)*\s*;/gm, weight: 4 },
      { pattern: /\bnamespace\s+[\w.]+/g, weight: 3 },
      { pattern: /\bConsole\.Write(?:Line)?\(/g, weight: 3 },
      { pattern: /\bpublic\s+(?:async\s+)?(?:class|void|string|int|Task)\b/g, weight: 2 },
      { pattern: /\b(?:get;|set;)\s*/g, weight: 3 },
      { pattern: /\bvar\s+\w+\s*=\s*new\b/g, weight: 2 }
    ]
  },
  {
    language: 'cpp',
    extension: '.cpp',
    signals: [
      ...C_SIGNALS,
      { pattern: /\bstd::\w+/g, weight: 3 },
      { pattern: /\b(?:cout|cin|endl)\b/g, weight: 3 },
      { pattern: /\btemplate\s*</g, weight: 3 },
      { pattern: /\b(?:nullptr|constexpr)\b/g, weight: 3 },
      { pattern: /\bclass\s+\w+\s*(?::\s*public\s+\w+\s*)?\{/g, weight: 2 }
    ]
  },
  { language: 'c', extension: '.c', signals: C_SIGNALS },
  {
    language: 'php',
    extension: '.php',
    signals: [
      { pattern: /<\?php/g, weight: 6 },
      { pattern: /\$\w+\s*=/g, weight: 1 },
      { pattern: /\bfunction\s+\w+\s*\(\s*\$/g, weight: 3 },
      { pattern: /->\w+\(/g, weight: 1 },
      { pattern: /\becho\s+["'$]/g, weight: 2 }
    ]
  },
  {
    language: 'ruby',
    extension: '.rb',
    signals: [
      { pattern: /^\s*def\s+\w+(?:\([^)]*\))?\s*$/gm, weight: 3 },
      { pattern: /^\s*end\s*$/gm, weight: 2 },
      { pattern: /\bputs\s+/g, weight: 2 },
      { pattern: /\bdo\s*\|[\w, ]+\|/g, weight: 3 },
      { pattern: /\battr_(?:accessor|reader|writer)\b/g, weight: 3 },
      { pattern: /\brequire(?:_relative)?\s+['"]/g, weight: 3 },
      { pattern: /^\s*class\s+\w+\s*<\s*\w+/gm, weight: 3 }
    ]
  },
  {
    language: 'shell',
    extension: '.sh',
    signals: [
      { pattern: /^#!.*\b(?:bash|sh|zsh)\b/m, weight: 6 },
      { pattern: /\bif\s+\[\[?\s/g, weight: 3 },
      { pattern: /^\s*(?:fi|esac|done)\s*$/gm, weight: 3 },
      { pattern: /\becho\s+["'$\w-]/g, weight: 1 },
      { pattern: /\$\{\w+[^}]*\}|\$\(\w/g, weight: 2 },
      { pattern: /^\s*\w+\(\)\s*\{/gm, weight: 2 },
      { pattern: /^\s*(?:export|local)\s+\w+=/gm, weight: 2 }
    ]
  },
  {
    language: 'powershell',
    extension: '.ps1',
    signals: [
      { pattern: /\bWrite-(?:Host|Output|Error)\b/g, weight: 4 },
      { pattern: /^\s*param\s*\(/gim, weight: 3 },
      { pattern: /\$(?:PSItem|PSScriptRoot|ErrorActionPreference|null|true|false)\b/g, weight: 3 },
      { pattern: /\b(?:Get|Set|New|Remove|Invoke|Test)-[A-Z]\w+\b/g, weight: 2 },
      { pattern: /\[Parameter\(/g, weight: 3 }
    ]
  },
  {
    language: 'html',
    extension: '.html',
    signals: [
      { pattern: /<!doctype\s+html>/i, weight: 6 },
      { pattern: /<(?:html|head|body|div|span|p|a|script|style|link|meta)\b[^>]*>/gi, weight: 2 },
      { pattern: /<\/(?:html|head|body|div|span|p|a|script|style)>/gi, weight: 2 }
    ]
  },
  {
    language: 'xml',
    extension: '.xml',
    signals: [
      { pattern: /^<\?xml\b/, weight: 6 },
      { pattern: /<\w+(?::\w+)?(?:\s+[\w:-]+="[^"]*")+\s*\/?>/g, weight: 2 },
      { pattern: /<\/\w+(?::\w+)?>/g, weight: 1 }
    ]
  },
  {
    language: 'css',
    extension: '.css',
    signals: [
      { pattern: /[.#]?[\w-]+(?:\s*[,>~+]\s*[.#]?[\w-]+)*\s*\{[^{}]*:[^{}]*;[^{}]*\}/g, weight: 3 },
      { pattern: /@(?:media|import|keyframes|font-face|supports)\b/g, weight: 3 },
      { pattern: /:\s*[\w-]+(?:\([^)]*\))?\s*(?:!important)?\s*;/g, weight: 1 },
      { pattern: /^\s*--[\w-]+\s*:/gm, weight: 2 }
    ]
  },
  {
    language: 'yaml',
    extension: '.yaml',
    signals: [
      { pattern: /^---\s*$/m, weight: 3 },
      { pattern: /^[\w.-]+:\s+\S/gm, weight: 2 },
      { pattern: /^\s+[\w.-]+:\s+\S/gm, weight: 1 },
      { pattern: /^\s*-\s+[\w"']/gm, weight: 1 }
    ]
  },
  {
    language: 'toml',
    extension: '.toml',
    signals: [
      { pattern: /^\[[\w.-]+\]\s*$/gm, weight: 3 },
      { pattern: /^[\w.-]+\s*=\s*(?:"[^"]*"|'[^']*'|\d+|true|false|\[)/gm, weight: 2 }
    ]
  },
  {
    language: 'dockerfile',
    extension: '.dockerfile',
    signals: [
      { pattern: /^FROM\s+\S+/m, weight: 4 },
      { pattern: /^(?:RUN|CMD|COPY|ADD|WORKDIR|ENTRYPOINT|EXPOSE|ENV|ARG|LABEL)\s+/gm, weight: 2 }
    ]
  }
]
