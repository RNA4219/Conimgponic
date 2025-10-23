import { describe, test } from 'node:test'

// RED: VS Code 拡張ブリッジの export.request/result 契約を固定する。
describe('vscode export bridge (RED)', () => {
  test.todo('markdown: LF 正規化・YAML frontmatter を保持して runs/<ts>/export/markdown/storyboard.md へ保存し URI を返す')
  test.todo('csv: RFC4180 (LF/quoted) 正規化と runs/<ts>/export/csv/storyboard.csv への書込 URI を返す')
  test.todo('jsonl: UTF-8 LF 区切りとキー順固定化を行い runs/<ts>/export/jsonl/storyboard.jsonl の URI を返す')
  test.todo('package: storyboard.json と meta.json を含む bundle を runs/<ts>/export/package/<ts>.zip に生成し URI を返す')
  test.todo('autosave: history/ 以下と runs/<ts>/export が競合しないようロック制御し retryable エラーを判別する')
  test.todo('telemetry: export.success/export.failed を Collector へ送信し再試行ポリシーと整合させる')
})
