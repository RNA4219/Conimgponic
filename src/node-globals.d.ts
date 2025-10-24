interface ProcessEnvLike {
  readonly [key: string]: string | undefined
}

interface ProcessLike {
  readonly env?: ProcessEnvLike
  readonly versions?: { readonly node?: string }
}

declare const process: ProcessLike | undefined
