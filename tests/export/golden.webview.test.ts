import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

type GoldenComparisonCase = { readonly id: string; readonly description: string; readonly expectedPath: string }

const goldenComparisonCases: readonly GoldenComparisonCase[] = [
  { id: 'markdown', description: 'Markdown エクスポートを正規化し runs/<runId>/export/markdown/storyboard.md とゴールデンを厳密比較する', expectedPath: 'runs/<runId>/export/markdown/storyboard.md' },
  { id: 'csv', description: 'CSV エクスポートを RFC4180 正規化後に runs/<runId>/export/csv/storyboard.csv とゴールデンで比較する', expectedPath: 'runs/<runId>/export/csv/storyboard.csv' },
  { id: 'jsonl', description: 'JSONL エクスポートをキー順固定で正規化し runs/<runId>/export/jsonl/storyboard.jsonl と比較する', expectedPath: 'runs/<runId>/export/jsonl/storyboard.jsonl' },
  { id: 'package', description: 'Package エクスポートを展開し内包ファイルおよび export-info.json をゴールデンと比較する', expectedPath: 'runs/<runId>/export/package/' },
  { id: 'result-contract', description: 'export.result が URI と normalized パスを返し、失敗時は { ok:false,error } で retryable を検証する', expectedPath: 'export.result contract' },
  { id: 'telemetry', description: 'AutoSave ロック競合やフォーマット未対応時のエラーが Collector へ telemetry export.failed として送信される', expectedPath: 'telemetry export.failed event' },
]

const diffFilePath = (() => {
  const currentFile = fileURLToPath(import.meta.url)
  const currentDir = dirname(currentFile)
  return resolve(currentDir, '..', '..', 'golden-diff.txt')
})()

const formatGoldenDiffReport = (cases: readonly GoldenComparisonCase[]): string => {
  const header = ['# export bridge golden comparison (RED)', '']
  const checklist = cases.map(({ id, description, expectedPath }) => `- [ ] ${id}: ${description} (expected: ${expectedPath})`)
  const footer = ['', '生成手順: pnpm run golden:diff (pnpm test --filter export)', 'このファイルは CI 失敗時の注釈用に自動生成されます。', '']
  return [...header, '未実装のゴールデン比較ケース一覧:', '', ...checklist, ...footer].join('\n')
}

const writeGoldenDiffReport = (cases: readonly GoldenComparisonCase[]): string => {
  const report = formatGoldenDiffReport(cases)
  rmSync(diffFilePath, { force: true })
  writeFileSync(diffFilePath, report, 'utf8')
  return report
}

// RED フェーズ: 正規化済みエクスポート出力と Webview ハンドシェイクを定義する。
describe('export bridge golden comparison (RED)', () => {
  for (const { description } of goldenComparisonCases) {
    test.todo(description)
  }

  test('writes golden diff checklist for CI annotations', () => {
    const report = writeGoldenDiffReport(goldenComparisonCases)
    const persisted = readFileSync(diffFilePath, 'utf8')

    assert.equal(persisted, report)
    assert.ok(persisted.includes('# export bridge golden comparison (RED)'))

    for (const { id, description, expectedPath } of goldenComparisonCases) {
      assert.ok(persisted.includes(`- [ ] ${id}: ${description} (expected: ${expectedPath})`))
    }
  })
})
