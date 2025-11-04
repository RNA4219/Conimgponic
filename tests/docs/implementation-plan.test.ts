import { readFileSync } from 'node:fs'
import { strict as assert } from 'node:assert'
import test from 'node:test'

const IMPLEMENTATION_PLAN_PATH = new URL('../../docs/IMPLEMENTATION-PLAN.md', import.meta.url)

const CHECKLIST_PATTERN =
  /- \[x\] `Collector` へのテレメトリ送信がフラグ ON\/OFF 双方で同一スキーマ（JSONL）を維持する統合テスト。 \((?<date>\d{4}-\d{2}-\d{2}), \[検証ログ: tests\/telemetry\/vscode\.contract\.test\.ts\]\(\.\.\/tests\/telemetry\/vscode\.contract\.test\.ts\)\)/

const AUTOSAVE_PATTERN =
  /- \[x\] AutoSave ランナー \(`src\/lib\/autosave\.ts` \/ `src\/platform\/vscode\/autosave\.ts`\) の Collector テレメトリ統合を完了した。 \((?<timestamp>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z) (?<result>成功|失敗|再検証中), \[検証ログ: tests\/platform\/vscode\/autosave\.telemetry\.test\.ts\]\(\.\.\/tests\/platform\/vscode\/autosave\.telemetry\.test\.ts\)\)/

test('Collector テレメトリ統合の進捗が記録されている', () => {
  const content = readFileSync(IMPLEMENTATION_PLAN_PATH, 'utf-8')
  const match = CHECKLIST_PATTERN.exec(content)

  assert.ok(match, '進捗チェックリストに完了済み項目を記録してください')

  const { date } = match!.groups ?? {}
  assert.ok(date, '完了日は YYYY-MM-DD 形式で記録してください')

  const parsed = Number.isNaN(Date.parse(`${date}T00:00:00Z`))
  assert.equal(parsed, false, '完了日は ISO8601 互換の日付にしてください')
})

test('AutoSave テレメトリ統合の進捗が記録されている', () => {
  const content = readFileSync(IMPLEMENTATION_PLAN_PATH, 'utf-8')
  const match = AUTOSAVE_PATTERN.exec(content)

  assert.ok(match, 'AutoSave テレメトリ統合の完了項目を記録してください')

  const { timestamp, result } = match!.groups ?? {}
  assert.ok(timestamp, '完了日時は YYYY-MM-DDThh:mmZ 形式で記録してください')
  assert.ok(result, '確認結果（成功/失敗/再検証中）を記録してください')

  const parsed = Number.isNaN(Date.parse(timestamp as string))
  assert.equal(parsed, false, '完了日時は ISO8601 互換の UTC 形式にしてください')
})
