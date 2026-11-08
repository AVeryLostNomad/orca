import type { CSharpToken } from './csharp-lexer'

export type CSharpSpan = { start: number; end: number }

export type CSharpAttribute = {
  /** Simple name without namespace or the `Attribute` suffix (e.g. `SerializeField`). */
  name: string
  /** Attribute target prefix such as `field` in `[field: SerializeField]`. */
  target?: string
}

export type CSharpParameter = {
  type: string
  name: string
  modifier?: 'ref' | 'out' | 'in' | 'params' | 'this' | 'scoped'
  hasDefault: boolean
  span: CSharpSpan
}

export type CSharpMethod = {
  kind: 'method'
  name: string
  nameSpan: CSharpSpan
  /** From the first attribute or modifier to the end of the body. */
  span: CSharpSpan
  /** From the first modifier (or the return type) to the parameter list's closing parenthesis. */
  signatureSpan: CSharpSpan
  returnType: string
  returnTypeSpan: CSharpSpan
  modifiers: string[]
  attributes: CSharpAttribute[]
  typeParameters: string[]
  parameters: CSharpParameter[]
  parameterListSpan: CSharpSpan
  /** Block `{...}` or expression body `=> ...;`; null for abstract/extern/partial. */
  body: (CSharpSpan & { expression: boolean }) | null
  /** Index range into the outline's tokens covering the body. */
  bodyTokens: { from: number; to: number } | null
}

export type CSharpField = {
  kind: 'field'
  type: string
  names: { name: string; span: CSharpSpan }[]
  span: CSharpSpan
  modifiers: string[]
  attributes: CSharpAttribute[]
}

export type CSharpProperty = {
  kind: 'property'
  type: string
  name: string
  nameSpan: CSharpSpan
  span: CSharpSpan
  modifiers: string[]
  attributes: CSharpAttribute[]
  /** True for `{ get; set; }`-style auto properties. */
  auto: boolean
}

export type CSharpOtherMember = {
  kind: 'constructor' | 'other'
  span: CSharpSpan
  bodyTokens: { from: number; to: number } | null
}

export type CSharpMember = CSharpMethod | CSharpField | CSharpProperty | CSharpOtherMember

export type CSharpBaseType = {
  /** Last identifier segment without type arguments (e.g. `MonoBehaviour`). */
  name: string
  /** Full written text, e.g. `UnityEngine.MonoBehaviour` or `Base<int>`. */
  text: string
  /** Span of the simple-name identifier, the position to ask a language server about. */
  nameSpan: CSharpSpan
}

export type CSharpTypeDeclaration = {
  kind: 'class' | 'struct' | 'interface' | 'record' | 'enum'
  name: string
  nameSpan: CSharpSpan
  span: CSharpSpan
  /** Offsets of the `{` and `}` of the body (end is the offset after `}`). */
  body: CSharpSpan | null
  baseTypes: CSharpBaseType[]
  modifiers: string[]
  attributes: CSharpAttribute[]
  members: CSharpMember[]
  nestedTypes: CSharpTypeDeclaration[]
  namespace: string | null
  containingType: CSharpTypeDeclaration | null
}

export type CSharpOutline = {
  text: string
  /** Significant tokens (comments and preprocessor lines removed). */
  tokens: CSharpToken[]
  /** All tokens including comments, for caret-context queries. */
  allTokens: CSharpToken[]
  usings: string[]
  /** Every type declaration, nested ones included, in source order. */
  types: CSharpTypeDeclaration[]
}
