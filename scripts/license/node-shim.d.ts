type Utf8Encoding = 'utf8'

interface ExecFileOptions {
  readonly encoding?: Utf8Encoding | null
  readonly maxBuffer?: number
}

interface ExecFileResult {
  readonly stdout: string
  readonly stderr: string
}

type ExecFileCallback = (error: unknown, stdout: string, stderr: string) => void

interface NodeWritableStream {
  write(data: string): void
}

interface NodeProcess {
  readonly argv: readonly string[]
  readonly cwd: () => string
  exitCode: number | undefined
  readonly stdout: NodeWritableStream
  readonly stderr: NodeWritableStream
}

declare const process: NodeProcess

declare module 'child_process' {
  function execFile(
    file: string,
    args: readonly string[],
    options: ExecFileOptions,
    callback: ExecFileCallback,
  ): unknown
  function execFile(file: string, args: readonly string[], callback: ExecFileCallback): unknown
  export { execFile }
}

declare module 'fs/promises' {
  function writeFile(path: string, data: string, options: Utf8Encoding | { readonly encoding: Utf8Encoding }): Promise<void>
  export { writeFile }
}

declare module 'path' {
  function resolve(...segments: readonly string[]): string
  export { resolve }
}

declare module 'url' {
  interface FileUrlLike {
    readonly href: string
  }
  function pathToFileURL(path: string): FileUrlLike
  export { pathToFileURL }
}

declare module 'util' {
  function promisify<TArgs extends readonly unknown[], TResult>(
    fn: (...args: [...TArgs, ExecFileCallback]) => unknown,
  ): (...args: TArgs) => Promise<TResult>
  export { promisify }
}
