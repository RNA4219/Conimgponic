/*
 * Minimal Node.js module declarations for the TypeScript-only test harness.
 * The project intentionally avoids bundling @types/node, so the declarations
 * below provide the small surface that autosave tests depend on while keeping
 * everything `any`-typed to stay permissive.
 */

declare module 'node:*' {
  const mod: any
  export default mod
  export = mod
}

declare module 'node:test' {
  export interface TestContext {
    readonly name: string
    readonly signal: AbortSignal
    readonly diagnostic: (...args: any[]) => void
    readonly cleanup: (...args: any[]) => void
    readonly after: (...args: any[]) => void
    readonly afterEach: (...args: any[]) => void
    readonly before: (...args: any[]) => void
    readonly beforeEach: (...args: any[]) => void
    readonly runOnly: (...args: any[]) => void
    readonly skip: (...args: any[]) => void
    readonly todo: (...args: any[]) => void
    readonly tests: readonly unknown[]
  }

  export interface TestFunction {
    (name: string, handler: (...args: any[]) => unknown): unknown
    (handler: (...args: any[]) => unknown): unknown
    only: TestFunction
    skip: TestFunction
    todo: TestFunction
  }

  const test: TestFunction
  const describe: TestFunction
  const it: TestFunction
  const before: TestFunction
  const beforeEach: TestFunction
  const after: TestFunction
  const afterEach: TestFunction

  export { test, describe, it, before, beforeEach, after, afterEach }
  export type { TestFunction }
  export type { TestContext }
  export default test
}

declare module 'node:assert/strict' {
  type AsyncOrSync = (...args: any[]) => unknown | Promise<unknown>

  interface AssertFn {
    (value: unknown, message?: string | Error): asserts value
    equal(actual: unknown, expected: unknown, message?: string | Error): void
    deepEqual(actual: unknown, expected: unknown, message?: string | Error): void
    deepStrictEqual(actual: unknown, expected: unknown, message?: string | Error): void
    notEqual(actual: unknown, expected: unknown, message?: string | Error): void
    notDeepEqual(actual: unknown, expected: unknown, message?: string | Error): void
    notDeepStrictEqual(actual: unknown, expected: unknown, message?: string | Error): void
    ok(value: unknown, message?: string | Error): asserts value
    rejects(fn: AsyncOrSync, error?: unknown, message?: string | Error): Promise<void>
    doesNotReject(fn: AsyncOrSync, error?: unknown, message?: string | Error): Promise<void>
    throws(fn: AsyncOrSync, error?: unknown, message?: string | Error): void
    doesNotThrow(fn: AsyncOrSync, error?: unknown, message?: string | Error): void
  }

  interface Assert extends AssertFn {
    strict: AssertFn
  }

  const assert: Assert

  export default assert
  export { assert }
  export const strict: AssertFn
  export const equal: AssertFn['equal']
  export const deepEqual: AssertFn['deepEqual']
  export const deepStrictEqual: AssertFn['deepStrictEqual']
  export const notEqual: AssertFn['notEqual']
  export const notDeepEqual: AssertFn['notDeepEqual']
  export const notDeepStrictEqual: AssertFn['notDeepStrictEqual']
  export const ok: AssertFn['ok']
  export const rejects: AssertFn['rejects']
  export const doesNotReject: AssertFn['doesNotReject']
  export const throws: AssertFn['throws']
  export const doesNotThrow: AssertFn['doesNotThrow']
}
