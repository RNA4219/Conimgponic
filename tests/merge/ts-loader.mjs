import { readFile } from 'node:fs/promises'
import ts from 'typescript'

export async function load(url, context, defaultLoad) {
  if (!url.endsWith('.ts')) {
    return defaultLoad(url, context, defaultLoad)
  }
  const source = await readFile(new URL(url))
  const transpiled = ts.transpileModule(source.toString(), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.Preserve,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      esModuleInterop: true,
    },
    fileName: url,
  })
  return {
    format: 'module',
    source: transpiled.outputText,
    shortCircuit: true,
  }
}
