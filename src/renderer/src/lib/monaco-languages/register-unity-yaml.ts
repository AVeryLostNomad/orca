import type * as Monaco from 'monaco-editor'

type MonacoModule = Pick<typeof Monaco, 'languages'>

// A separate id from 'yaml' keeps the YAML language server off Unity's custom !u! tags and stripped documents.
export const UNITY_YAML_LANGUAGE_ID = 'unity-yaml'

export const unityYamlLanguageConfiguration: Monaco.languages.LanguageConfiguration = {
  comments: { lineComment: '#' },
  brackets: [
    ['{', '}'],
    ['[', ']']
  ],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '"', close: '"', notIn: ['string'] },
    { open: "'", close: "'", notIn: ['string'] }
  ],
  surroundingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '"', close: '"' },
    { open: "'", close: "'" }
  ],
  // Unity writes each object's class key at column zero, so indentation folding collapses whole objects.
  folding: { offSide: true },
  indentationRules: {
    increaseIndentPattern: /^\s*.*(?::|-) ?(?:&\w+)?(?:\{[^}"']*|\([^)"']*)?$/,
    decreaseIndentPattern: /^\s+\}$/
  }
}

// Scopes are TextMate names so Orca's converted VS Code themes color them directly.
export const unityYamlMonarchLanguage: Monaco.languages.IMonarchLanguage = {
  defaultToken: '',
  tokenPostfix: '.unity-yaml',
  // The trailing newline lets value states end at the line break.
  includeLF: true,
  brackets: [
    { open: '{', close: '}', token: 'delimiter.curly' },
    { open: '[', close: ']', token: 'delimiter.square' }
  ],
  tokenizer: {
    root: [
      [/^(%YAML)([ \t]+)(\S+)/, ['keyword.control.directive', '', 'constant.numeric']],
      [
        /^(%TAG)([ \t]+)(\S+)([ \t]+)(\S+)/,
        ['keyword.control.directive', '', 'storage.type.tag-handle', '', 'string.other.link.tag']
      ],
      [
        /^(---)([ \t]+)(!u!)(\d+)([ \t]+)(&)(-?\d+)/,
        [
          'punctuation.definition.document',
          '',
          'storage.type.tag-handle',
          'constant.numeric.class-id',
          '',
          'punctuation.definition.anchor',
          'entity.name.type.anchor'
        ]
      ],
      [/^(?:---|\.\.\.)(?=\s|$)/, 'punctuation.definition.document'],
      [/stripped(?=\s|$)/, 'keyword.other.stripped'],
      [/[ \t\r\n]+/, ''],
      [/#[^\n]*/, 'comment.line'],
      [/-(?=\s|$)/, 'punctuation.definition.sequence.item'],
      [/(?:fileID|guid)(?=[ \t]*:\s)/, 'keyword.other.reference'],
      // Column-zero keys name the serialized class (GameObject:, MonoBehaviour:, TextureImporter:).
      [/^[A-Za-z_]\w*(?=:\s)/, 'entity.name.type.class'],
      [/[^\s#'"{}[\],:&*!|>%@`-][^\n#]*?(?=[ \t]*:\s)/, 'entity.name.tag'],
      [/"(?:[^"\\]|\\.)*"(?=[ \t]*:\s)/, 'entity.name.tag'],
      [/:(?=\s)/, 'punctuation.separator.key-value', '@value'],
      [/(?=\S)/, '', '@value']
    ],
    value: [
      [/\n/, '', '@pop'],
      [/[ \t\r]+/, ''],
      [/#[^\n]*/, 'comment.line'],
      [/\{/, 'punctuation.definition.mapping.begin', '@flowMap'],
      [/\[/, 'punctuation.definition.sequence.begin', '@flowSequence'],
      [/"/, 'string.quoted.double', '@doubleQuoted'],
      [/'/, 'string.quoted.single', '@singleQuoted'],
      [/&\S+/, 'entity.name.type.anchor'],
      [/\*\S+/, 'variable.other.alias'],
      [/!\S*/, 'storage.type.tag-handle'],
      [/[|>][-+]?\d*(?=[ \t]*(?:#|\n|$))/, 'keyword.control.flow.block-scalar'],
      [/[0-9a-fA-F]{32}(?=[ \t]*(?:#|\n|$))/, 'string.other.link.guid'],
      [/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?(?=[ \t]*(?:#|\n|$))/, 'constant.numeric'],
      [/(?:true|false|null|~)(?=[ \t]*(?:#|\n|$))/, 'constant.language'],
      [/[^\n]+?(?=[ \t]+#|[ \t]*\n|$)/, 'string.unquoted']
    ],
    flowMap: [
      [/\s+/, ''],
      [/\}/, 'punctuation.definition.mapping.end', '@pop'],
      [/(?:fileID|guid|type)(?=\s*:\s)/, 'keyword.other.reference'],
      { include: '@flowContent' }
    ],
    flowSequence: [
      [/\s+/, ''],
      [/\]/, 'punctuation.definition.sequence.end', '@pop'],
      { include: '@flowContent' }
    ],
    flowContent: [
      [/,/, 'punctuation.separator.flow'],
      [/:(?=\s)/, 'punctuation.separator.key-value'],
      [/\{/, 'punctuation.definition.mapping.begin', '@flowMap'],
      [/\[/, 'punctuation.definition.sequence.begin', '@flowSequence'],
      [/"/, 'string.quoted.double', '@doubleQuoted'],
      [/'/, 'string.quoted.single', '@singleQuoted'],
      [/[^\s,:{}[\]]+(?=\s*:\s)/, 'entity.name.tag'],
      [/[0-9a-fA-F]{32}(?=\s*[,}\]])/, 'string.other.link.guid'],
      [/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?(?=\s*[,}\]])/, 'constant.numeric'],
      [/[^,{}[\]\n]+?(?=\s*[,{}[\]\n])/, 'string.unquoted'],
      [/[^,{}[\]\n]+/, 'string.unquoted']
    ],
    doubleQuoted: [
      [/[^"\\]+/, 'string.quoted.double'],
      [/\\./, 'constant.character.escape'],
      [/"/, 'string.quoted.double', '@pop']
    ],
    singleQuoted: [
      [/[^']+/, 'string.quoted.single'],
      [/''/, 'constant.character.escape'],
      [/'/, 'string.quoted.single', '@pop']
    ]
  }
}

export function registerUnityYamlLanguage(monaco: MonacoModule): void {
  if (monaco.languages.getLanguages().some((language) => language.id === UNITY_YAML_LANGUAGE_ID)) {
    return
  }
  monaco.languages.register({
    id: UNITY_YAML_LANGUAGE_ID,
    extensions: [
      '.unity',
      '.prefab',
      '.asset',
      '.mat',
      '.anim',
      '.controller',
      '.overrideController',
      '.physicMaterial',
      '.physicsMaterial2D',
      '.mask',
      '.playable',
      '.signal',
      '.lighting',
      '.terrainlayer',
      '.spriteatlas',
      '.spriteatlasv2',
      '.preset',
      '.guiskin',
      '.fontsettings',
      '.mixer',
      '.renderTexture',
      '.brush',
      '.flare',
      '.cubemap',
      '.giparams',
      '.shadervariants',
      '.vfx',
      '.meta'
    ],
    aliases: ['Unity YAML', 'unity-yaml']
  })
  monaco.languages.setLanguageConfiguration(UNITY_YAML_LANGUAGE_ID, unityYamlLanguageConfiguration)
  monaco.languages.setMonarchTokensProvider(UNITY_YAML_LANGUAGE_ID, unityYamlMonarchLanguage)
}
