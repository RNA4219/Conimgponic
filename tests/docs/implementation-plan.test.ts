import { readFileSync } from 'node:fs'
import { strict as assert } from 'node:assert'
import test from 'node:test'

const IMPLEMENTATION_PLAN_PATH = new URL('../../docs/IMPLEMENTATION-PLAN.md', import.meta.url)
const CONFIG_FLAGS_PATH = new URL('../../docs/CONFIG_FLAGS.md', import.meta.url)

const CHECKLIST_PATTERN =
  /- \[x\] `Collector` へのテレメトリ送信がフラグ ON\/OFF 双方で同一スキーマ（JSONL）を維持する統合テスト。 \((?<date>\d{4}-\d{2}-\d{2}), \[検証ログ: tests\/platform\/vscode\/autosave\/autosave\.responsibility\.test\.ts\]\(\.\.\/tests\/platform\/vscode\/autosave\/autosave\.responsibility\.test\.ts\)\)/
  /- \[x\] `Collector` へのテレメトリ送信がフラグ ON\/OFF 双方で同一スキーマ（JSONL）を維持する統合テスト。 \((?<date>\d{4}-\d{2}-\d{2}), \[検証ログ: tests\/platform\/vscode\/autosave\/autosave\.responsibility\.test\.ts\]\(\.\.\/tests\/platform\/vscode\/autosave\/autosave\.responsibility\.test\.ts\), \[tests\/platform\/vscode\/autosave\/autosave\.collector-export\.test\.ts\]\(\.\.\/tests\/platform\/vscode\/autosave\/autosave\.collector-export\.test\.ts\)\)/
  /- \[x\] \(Issue #1\) `Collector` へのテレメトリ送信がフラグ ON\/OFF 双方で同一スキーマ（JSONL）を維持する統合テスト。 \((?<date>\d{4}-\d{2}-\d{2}), \[検証ログ: tests\/telemetry\/vscode\.contract\.test\.ts\]\(\.\.\/tests\/telemetry\/vscode\.contract\.test\.ts\)\)/

const AUTOSAVE_PATTERN =
  /- \[x\] AutoSave ランナー \(`src\/lib\/autosave\.ts` \/ `src\/platform\/vscode\/autosave\.ts`\) の Collector テレメトリ統合を完了した。 \((?<timestamp>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z) (?<result>成功|失敗|再検証中), \[検証ログ: tests\/platform\/vscode\/autosave\.collector-export\.test\.ts\]\(\.\.\/tests\/platform\/vscode\/autosave\.collector-export\.test\.ts\)\)/

const AUTOSAVE_DETAIL_PATTERNS: Record<string, RegExp> = {
  'src/lib/autosave.ts':
    /-\s+src\/lib\/autosave\.ts:\s+(?<timestamp>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z)\s+(?<result>成功|失敗|再検証中),\s+\[検証ログ: tests\/lib\/autosave\.telemetryBridge\.test\.ts\]\(\.\.\/tests\/lib\/autosave\.telemetryBridge\.test\.ts\)/,
  'src/platform/vscode/autosave.ts':
    /-\s+src\/platform\/vscode\/autosave\.ts:\s+(?<timestamp>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z)\s+(?<result>成功|失敗|再検証中),\s+\[検証ログ: tests\/platform\/vscode\/autosave\.collector-export\.test\.ts\]\(\.\.\/tests\/platform\/vscode\/autosave\.collector-export\.test\.ts\)/
}

test('Collector テレメトリ統合の進捗が記録されている', () => {
  const content = readFileSync(IMPLEMENTATION_PLAN_PATH, 'utf-8')
  const match = CHECKLIST_PATTERN.exec(content)

  assert.ok(match, '進捗チェックリストに完了済み項目を記録してください')

  const { date } = match?.groups ?? {}
  assert.ok(date, '完了日は YYYY-MM-DD 形式で記録してください')

  const parsed = Number.isNaN(Date.parse(`${date}T00:00:00Z`))
  assert.equal(parsed, false, '完了日は ISO8601 互換の日付にしてください')
})
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

  for (const [label, pattern] of Object.entries(AUTOSAVE_DETAIL_PATTERNS)) {
    const detailMatch = pattern.exec(content)
    assert.ok(detailMatch, `${label} の完了日時と確認結果を記録してください`)

    const detailTimestamp = detailMatch!.groups?.timestamp
    const detailResult = detailMatch!.groups?.result

    assert.ok(detailTimestamp, `${label} の完了日時は YYYY-MM-DDThh:mmZ 形式で記録してください`)
    assert.ok(detailResult, `${label} の確認結果（成功/失敗/再検証中）を記録してください`)

    const detailParsed = Number.isNaN(Date.parse(detailTimestamp as string))
    assert.equal(
      detailParsed,
      false,
      `${label} の完了日時は ISO8601 互換の UTC 形式にしてください`
    )
  }
})

test('CONFIG_FLAGS へ Issue #1 の Collector 連携履歴を記録している', () => {
  const content = readFileSync(CONFIG_FLAGS_PATH, 'utf-8')

  assert.ok(
    content.includes('- 2024-06-19: Issue #1 Collector 連携手順を Phase ガード運用フローと再同期し、'),
    'CONFIG_FLAGS.md に Issue #1 Collector 連携手順の更新日と要約を追加してください'
  )
  assert.ok(
    content.includes(
      '[検証ログ: tests/telemetry/vscode.contract.test.ts](../tests/telemetry/vscode.contract.test.ts)'
    ),
    'CONFIG_FLAGS.md に Collector コントラクトの検証ログをリンクしてください'
  )
  assert.ok(
    content.includes(
      '[検証ログ: tests/platform/vscode/autosave.collector-export.test.ts](../tests/platform/vscode/autosave.collector-export.test.ts)'
    ),
    'CONFIG_FLAGS.md に AutoSave ブリッジの検証ログをリンクしてください'
  )
  assert.ok(
    content.includes('`docs/IMPLEMENTATION-PLAN.md` のチェックリストと同日付で整合させた。'),
    'CONFIG_FLAGS.md で IMPLEMENTATION-PLAN.md のチェックリストと同日付で整合したことを明記してください'
  )
})
