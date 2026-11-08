import type * as Monaco from 'monaco-editor'

type MonacoModule = Pick<typeof Monaco, 'languages'>

export const HLSL_LANGUAGE_ID = 'hlsl'

export const hlslLanguageConfiguration: Monaco.languages.LanguageConfiguration = {
  comments: { lineComment: '//', blockComment: ['/*', '*/'] },
  brackets: [
    ['{', '}'],
    ['[', ']'],
    ['(', ')']
  ],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"', notIn: ['string', 'comment'] },
    { open: '/*', close: ' */', notIn: ['string'] }
  ],
  surroundingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"' }
  ],
  indentationRules: {
    increaseIndentPattern: /^.*\{[^}"']*$|^.*\([^)"']*$/,
    decreaseIndentPattern: /^\s*[}\]),]/
  },
  folding: {
    markers: {
      start: /^\s*#\s*(?:region\b|if)/,
      end: /^\s*#\s*(?:endregion\b|endif\b)/
    }
  }
}

// Whitespace-separated literals keep the long Monarch keyword tables compact.
export function monarchWordList(text: string): string[] {
  return text.trim().split(/\s+/)
}

// Monarch states shared with the ShaderLab grammar, which embeds HLSL between HLSLPROGRAM/CGPROGRAM and ENDHLSL/ENDCG.
export const hlslMonarchAttributes = {
  hlslControlKeywords: monarchWordList(`
    if else for while do switch case default break continue return discard
  `),
  hlslStorageKeywords: monarchWordList(`
    struct cbuffer tbuffer typedef class interface namespace technique technique10 technique11
    pass template typename
  `),
  hlslModifiers: monarchWordList(`
    const static uniform volatile extern inline in out inout shared groupshared precise
    nointerpolation linear centroid noperspective sample row_major column_major snorm unorm
    globallycoherent point line triangle lineadj triangleadj register packoffset
  `),
  hlslConstants: ['true', 'false', 'NULL'],
  hlslPlainTypes: ['void', 'string', 'vector', 'matrix'],
  hlslObjectTypes: monarchWordList(`
    sampler sampler1D sampler2D sampler3D samplerCUBE sampler2D_float sampler2D_half
    sampler2DArray samplerCUBE_float samplerCUBE_half sampler_state SamplerState
    SamplerComparisonState Texture Texture1D Texture1DArray Texture2D Texture2DArray Texture2DMS
    Texture2DMSArray Texture3D TextureCube TextureCubeArray Buffer ConstantBuffer
    StructuredBuffer ByteAddressBuffer AppendStructuredBuffer ConsumeStructuredBuffer RWBuffer
    RWStructuredBuffer RWByteAddressBuffer RWTexture1D RWTexture1DArray RWTexture2D
    RWTexture2DArray RWTexture3D RasterizerOrderedTexture2D RasterizerOrderedBuffer
    RaytracingAccelerationStructure RayDesc BuiltInTriangleIntersectionAttributes InputPatch
    OutputPatch PointStream LineStream TriangleStream
  `),
  hlslIntrinsics: monarchWordList(`
    abort abs acos all AllMemoryBarrier AllMemoryBarrierWithGroupSync any asdouble asfloat asin
    asint asuint atan atan2 ceil CheckAccessFullyMapped clamp clip cos cosh countbits cross
    D3DCOLORtoUBYTE4 ddx ddx_coarse ddx_fine ddy ddy_coarse ddy_fine degrees determinant
    DeviceMemoryBarrier DeviceMemoryBarrierWithGroupSync distance dot dst errorf
    EvaluateAttributeAtCentroid EvaluateAttributeAtSample EvaluateAttributeSnapped exp exp2
    f16tof32 f32tof16 faceforward firstbithigh firstbitlow floor fma fmod frac frexp fwidth
    GetRenderTargetSampleCount GetRenderTargetSamplePosition GroupMemoryBarrier
    GroupMemoryBarrierWithGroupSync InterlockedAdd InterlockedAnd InterlockedCompareExchange
    InterlockedCompareStore InterlockedExchange InterlockedMax InterlockedMin InterlockedOr
    InterlockedXor isfinite isinf isnan ldexp length lerp lit log log10 log2 mad max min modf
    msad4 mul noise normalize pow printf radians rcp reflect refract reversebits round rsqrt
    saturate sign sin sincos sinh smoothstep sqrt step tan tanh tex1D tex1Dbias tex1Dgrad
    tex1Dlod tex1Dproj tex2D tex2Dbias tex2Dgrad tex2Dlod tex2Dproj tex3D tex3Dbias tex3Dgrad
    tex3Dlod tex3Dproj texCUBE texCUBEbias texCUBEgrad texCUBElod texCUBEproj transpose trunc
    TraceRay ReportHit CallShader IgnoreHit AcceptHitAndEndSearch DispatchRaysIndex
    DispatchRaysDimensions WaveGetLaneCount WaveGetLaneIndex WaveIsFirstLane WaveActiveAllEqual
    WaveActiveAllTrue WaveActiveAnyTrue WaveActiveBallot WaveActiveBitAnd WaveActiveBitOr
    WaveActiveBitXor WaveActiveCountBits WaveActiveMax WaveActiveMin WaveActiveProduct
    WaveActiveSum WavePrefixCountBits WavePrefixProduct WavePrefixSum WaveReadLaneAt
    WaveReadLaneFirst QuadReadAcrossDiagonal QuadReadAcrossX QuadReadAcrossY QuadReadLaneAt
  `),
  hlslScalarTypes:
    /(?:bool|int|uint|dword|half|float|double|fixed|min16float|min10float|min16int|min12int|min16uint|real)(?:[1-4](?:x[1-4])?)?/
}

const SEMANTIC_PATTERN =
  'SV_\\w+|(?:POSITION|NORMAL|TEXCOORD|COLOR|TANGENT|BINORMAL|BLENDWEIGHT|BLENDINDICES|PSIZE|DEPTH|FOG|TESSFACTOR|POSITIONT)\\d*|VFACE|VPOS'

export const hlslMonarchTokenizerStates: Record<string, Monaco.languages.IMonarchLanguageRule[]> = {
  hlslCode: [
    [/[ \t\r\n]+/, ''],
    [/\/\/.*$/, 'comment.line'],
    [/\/\*/, 'comment.block', '@hlslBlockComment'],
    [
      /(#\s*include(?:_with_pragmas)?)(\s*)("[^"]*"|<[^>]*>)/,
      ['keyword.control.directive', '', 'string.quoted.include']
    ],
    [
      /(#\s*(?:define|undef|ifdef|ifndef))(\s+)([A-Za-z_]\w*)/,
      ['keyword.control.directive', '', 'entity.name.function.preprocessor']
    ],
    [/(#\s*pragma)(\s+)([A-Za-z_]\w*)/, ['keyword.control.directive', '', 'keyword.other.pragma']],
    [
      /#\s*(?:if|elif|else|endif|error|warning|line|pragma|define|undef|include|region|endregion)\b/,
      'keyword.control.directive'
    ],
    [/\bdefined\b/, 'keyword.control.directive'],
    [
      /(\[)(\s*)(numthreads|unroll|loop|branch|flatten|fastopt|allow_uav_condition|call|forcecase|earlydepthstencil|maxvertexcount|domain|partitioning|outputtopology|outputcontrolpoints|patchconstantfunc|maxtessfactor|instance|shader|RootSignature|WaveSize)\b/,
      ['delimiter.square', '', 'entity.other.attribute-name']
    ],
    [
      new RegExp(`(:)(\\s*)(${SEMANTIC_PATTERN})\\b`),
      ['keyword.operator', '', 'support.variable.semantic']
    ],
    [/\bSV_\w+\b/, 'support.variable.semantic'],
    [
      /[A-Za-z_]\w*(?=\s*\()/,
      {
        cases: {
          '@hlslControlKeywords': 'keyword.control',
          '@hlslIntrinsics': 'support.function',
          '@hlslObjectTypes': 'support.type',
          '~@hlslScalarTypes': 'storage.type',
          '@hlslPlainTypes': 'storage.type',
          '[A-Z][A-Z0-9_]*': 'entity.name.function.macro',
          '@default': 'entity.name.function'
        }
      }
    ],
    [
      /[A-Za-z_]\w*/,
      {
        cases: {
          '@hlslControlKeywords': 'keyword.control',
          '@hlslStorageKeywords': 'storage.type.structure',
          '@hlslModifiers': 'storage.modifier',
          '@hlslConstants': 'constant.language',
          '@hlslObjectTypes': 'support.type',
          '~@hlslScalarTypes': 'storage.type',
          '@hlslPlainTypes': 'storage.type',
          '[A-Z][A-Z0-9_]*': 'variable.other.constant',
          '@default': 'identifier'
        }
      }
    ],
    [/"/, 'string.quoted.double', '@hlslString'],
    [/0[xX][0-9a-fA-F]+[uUlL]*/, 'constant.numeric.hex'],
    [/(?:\d+\.\d*|\.\d+)(?:[eE][-+]?\d+)?[fFhHlL]?/, 'constant.numeric.float'],
    [/\d+[eE][-+]?\d+[fFhHlL]?/, 'constant.numeric.float'],
    [/\d+[uUlLfFhH]*/, 'constant.numeric'],
    [/[{}()[\]]/, '@brackets'],
    [/[;,.]/, 'delimiter'],
    [/[=><!~?:&|+\-*/^%]+/, 'keyword.operator'],
    [/\\$/, 'constant.character.escape.line-continuation']
  ],
  hlslBlockComment: [
    [/[^*]+/, 'comment.block'],
    [/\*\//, 'comment.block', '@pop'],
    [/\*/, 'comment.block']
  ],
  hlslString: [
    [/[^"\\]+/, 'string.quoted.double'],
    [/\\./, 'constant.character.escape'],
    [/"/, 'string.quoted.double', '@pop']
  ]
}

export const hlslMonarchLanguage: Monaco.languages.IMonarchLanguage = {
  defaultToken: '',
  tokenPostfix: '.hlsl',
  brackets: [
    { open: '{', close: '}', token: 'delimiter.curly' },
    { open: '[', close: ']', token: 'delimiter.square' },
    { open: '(', close: ')', token: 'delimiter.parenthesis' }
  ],
  ...hlslMonarchAttributes,
  tokenizer: {
    root: [{ include: '@hlslCode' }],
    ...hlslMonarchTokenizerStates
  }
}

export function registerHlslLanguage(monaco: MonacoModule): void {
  if (monaco.languages.getLanguages().some((language) => language.id === HLSL_LANGUAGE_ID)) {
    return
  }
  monaco.languages.register({
    id: HLSL_LANGUAGE_ID,
    extensions: ['.hlsl', '.hlslinc', '.cginc', '.compute', '.raytrace', '.glslinc'],
    aliases: ['HLSL', 'hlsl']
  })
  monaco.languages.setLanguageConfiguration(HLSL_LANGUAGE_ID, hlslLanguageConfiguration)
  monaco.languages.setMonarchTokensProvider(HLSL_LANGUAGE_ID, hlslMonarchLanguage)
}
