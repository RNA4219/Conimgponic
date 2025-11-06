import { readFileSync } from 'node:fs'
import { strict as assert } from 'node:assert'
import test from 'node:test'

const IMPLEMENTATION_PLAN_PATH = new URL('../../docs/IMPLEMENTATION-PLAN.md', import.meta.url)

const CHECKLIST_PATTERN =
  /- \[x\] `Collector` へのテレメトリ送信がフラグ ON\/OFF 双方で同一スキーマ（JSONL）を維持する統合テスト。 \((?<date>\d{4}-\d{2}-\d{2}), \[検証ログ: tests\/platform\/vscode\/autosave\/autosave\.responsibility\.test\.ts\]\(\.\.\/tests\/platform\/vscode\/autosave\/autosave\.responsibility\.test\.ts\), \[tests\/platform\/vscode\/autosave\/autosave\.collector-export\.test\.ts\]\(\.\.\/tests\/platform\/vscode\/autosave\/autosave\.collector-export\.test\.ts\)\)/

test('Collector テレメトリ統合の進捗が記録されている', () => {
  const content = readFileSync(IMPLEMENTATION_PLAN_PATH, 'utf-8')
  const match = CHECKLIST_PATTERN.exec(content)

  assert.ok(match, '進捗チェックリストに完了済み項目を記録してください')

  const { date } = match?.groups ?? {}
  assert.ok(date, '完了日は YYYY-MM-DD 形式で記録してください')

  const parsed = Number.isNaN(Date.parse(`${date}T00:00:00Z`))
  assert.equal(parsed, false, '完了日は ISO8601 互換の日付にしてください')
})