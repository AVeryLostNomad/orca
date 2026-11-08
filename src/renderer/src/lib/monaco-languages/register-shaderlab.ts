import type * as Monaco from 'monaco-editor'
import {
  hlslLanguageConfiguration,
  hlslMonarchAttributes,
  hlslMonarchTokenizerStates,
  monarchWordList
} from './register-hlsl'

type MonacoModule = Pick<typeof Monaco, 'languages'>

export const SHADERLAB_LANGUAGE_ID = 'shaderlab'

export const shaderlabLanguageConfiguration: Monaco.languages.LanguageConfiguration = {
  ...hlslLanguageConfiguration,
  folding: {
    markers: {
      start: /^\s*(?:#\s*(?:region\b|if)|(?:HLSL|CG|GLSL)(?:PROGRAM|INCLUDE)\b)/,
      end: /^\s*(?:#\s*(?:endregion\b|endif\b)|END(?:HLSL|CG|GLSL)\b)/
    }
  }
}

// ShaderLab keywords are case-insensitive, but files overwhelmingly use the documented PascalCase or all-lowercase.
function withLowercase(text: string): string[] {
  return monarchWordList(text).flatMap((word) => [word, word.toLowerCase()])
}

export const shaderlabMonarchLanguage: Monaco.languages.IMonarchLanguage = {
  defaultToken: '',
  tokenPostfix: '.shaderlab',
  brackets: [
    { open: '{', close: '}', token: 'delimiter.curly' },
    { open: '[', close: ']', token: 'delimiter.square' },
    { open: '(', close: ')', token: 'delimiter.parenthesis' }
  ],
  ...hlslMonarchAttributes,
  shaderlabStructures: withLowercase(`
    Shader Properties SubShader Pass Category UsePass GrabPass Fallback FallBack CustomEditor
    CustomEditorForRenderPipeline Dependency PackageRequirements
  `),
  shaderlabCommands: withLowercase(`
    Name Tags LOD Cull ZWrite ZTest ZClip Offset Blend BlendOp ColorMask AlphaToMask
    Conservative Lighting Stencil Ref ReadMask WriteMask Comp CompBack CompFront PassFront
    PassBack Fail FailBack FailFront ZFail ZFailBack ZFailFront Material Diffuse Ambient
    Shininess Specular Emission Fog Mode Density SeparateSpecular SetTexture Combine
    ConstantColor Matrix AlphaTest ColorMaterial BindChannels Bind
  `),
  shaderlabPropertyTypes: withLowercase(`
    Range Float Int Integer Color Vector 2D 3D Cube 2DArray 3DArray CubeArray Any
  `),
  shaderlabValues: withLowercase(`
    Off On Back Front Zero One SrcColor SrcAlpha SrcAlphaSaturate DstColor DstAlpha
    OneMinusSrcColor OneMinusSrcAlpha OneMinusDstColor OneMinusDstAlpha Less Greater LEqual
    GEqual Equal NotEqual Always Never Keep Replace IncrSat DecrSat Invert IncrWrap DecrWrap Add
    Sub RevSub Min Max True False Previous Primary Texture Constant Double Quad Alpha RGB
  `),
  tokenizer: {
    root: [
      [/[ \t\r\n]+/, ''],
      [/\/\/.*$/, 'comment.line'],
      [/\/\*/, 'comment.block', '@hlslBlockComment'],
      [/\b(?:HLSL|CG|GLSL)(?:PROGRAM|INCLUDE)\b/, 'keyword.control.embedded.begin', '@hlslBlock'],
      // Property references inside commands: Blend [_SrcBlend] [_DstBlend].
      [
        /(\[)(\s*)(_\w*)(\s*)(\])/,
        ['delimiter.square', '', 'variable.other.property', '', 'delimiter.square']
      ],
      // Property drawer attributes: [HDR], [NoScaleOffset], [Toggle(_FOO)], [Header(...)].
      [/(\[)(\s*)([A-Za-z]\w*)/, ['delimiter.square', '', 'entity.other.attribute-name']],
      [/("[^"]*")(\s*)(=)/, ['support.type.property-name', '', 'keyword.operator']],
      [/"/, 'string.quoted.double', '@hlslString'],
      [/\b2D(?:Array)?\b|\b3D(?:Array)?\b/, 'support.type'],
      [/_\w*/, 'variable.other.property'],
      [
        /[A-Za-z]\w*/,
        {
          cases: {
            '@shaderlabStructures': 'storage.type.structure',
            '@shaderlabPropertyTypes': 'support.type',
            '@shaderlabCommands': 'keyword.other.command',
            '@shaderlabValues': 'constant.language',
            '@default': 'identifier'
          }
        }
      ],
      [/-?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)?/, 'constant.numeric'],
      [/[{}()[\]]/, '@brackets'],
      [/[,;]/, 'delimiter'],
      [/[=<>!|&+\-*/]+/, 'keyword.operator']
    ],
    hlslBlock: [
      [/\bEND(?:HLSL|CG|GLSL)\b/, 'keyword.control.embedded.end', '@pop'],
      { include: '@hlslCode' }
    ],
    ...hlslMonarchTokenizerStates
  }
}

export function registerShaderlabLanguage(monaco: MonacoModule): void {
  if (monaco.languages.getLanguages().some((language) => language.id === SHADERLAB_LANGUAGE_ID)) {
    return
  }
  monaco.languages.register({
    id: SHADERLAB_LANGUAGE_ID,
    extensions: ['.shader'],
    aliases: ['ShaderLab', 'shaderlab']
  })
  monaco.languages.setLanguageConfiguration(SHADERLAB_LANGUAGE_ID, shaderlabLanguageConfiguration)
  monaco.languages.setMonarchTokensProvider(SHADERLAB_LANGUAGE_ID, shaderlabMonarchLanguage)
}
