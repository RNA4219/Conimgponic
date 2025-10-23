# Flag Resolution Telemetry — Day8 Collector v1

## イベントスキーマ (Collector schema v1)

| イベント | JSONL フィールド | 計算式 / 参照 | Rollback 条件 | 備考 |
| --- | --- | --- | --- | --- |
| `flag_resolution` | `payload.flag`, `payload.variant`, `payload.source`, `payload.phase`, `payload.evaluation_ms` | `evaluation_ms` の移動平均を算出し、Collector→Analyzer の遅延を ±5% SLO で監視 | 同一フェーズ内で `status="failure"` が 2 バッチ継続した場合に `rollbackTo` を `payload.phase` に設定 | `source` と `variant` を `FlagSnapshot` から転記し、Phase ガード解除判定の根拠とする |
| `status.autosave` | `payload.state`, `payload.debounce_ms`, `payload.latency_ms`, `payload.attempt`, `payload.phase_step`, `payload.guard.current`, `payload.guard.rollbackTo` | `latency_ms` から `autosave_p95` を算出。`phase_step` のヒストグラムで待機比率を計測 | `ui_saved_rate < 0.95` または `autosave_p95` が基準比 +5% を 2 バッチ連続で超過 | Guard 情報は `flag_resolution` のフェーズと連動し、Reporter が rollback checklist に転記する |
| `merge.trace` | `payload.phase`, `payload.collisions`, `payload.processing_ms`, `payload.guardrail.metric`, `payload.guardrail.observed`, `payload.guardrail.tolerance_pct`, `payload.guardrail.rollbackTo`, `payload.digest` | `processing_ms` を P95 化し、`observed` が `tolerance_pct` (±5%) を超過した割合を算出 | `observed` 超過が 2 バッチ続いたら `payload.guardrail.rollbackTo` へフェーズ差し戻し | `digest` は Analyzer のハッシュ衝突を防ぐ監査キー |

## サンプル JSONL (RED テスト入力)

```jsonl
{"schema":"vscode.telemetry.v1","event":"flag_resolution","ts":"2025-01-18T00:00:00.000Z","correlationId":"f6b62aa6-d365-4270-966a-32e65b0b3f46","phase":"A-1","attempt":1,"maxAttempts":3,"backoffMs":[100,300,900],"payload":{"flag":"autosave.enabled","variant":"true","source":"env","phase":"A-1","evaluation_ms":42}}
{"schema":"vscode.telemetry.v1","event":"status.autosave","ts":"2025-01-18T00:00:01.250Z","correlationId":"f6b62aa6-d365-4270-966a-32e65b0b3f46","phase":"A-1","attempt":1,"maxAttempts":3,"backoffMs":[100,300,900],"payload":{"state":"saving","debounce_ms":500,"latency_ms":1200,"attempt":1,"phase_step":"awaiting-lock","guard":{"current":"A-1","rollbackTo":"A-0"}}}
{"schema":"vscode.telemetry.v1","event":"merge.trace","ts":"2025-01-18T00:00:04.512Z","correlationId":"cb6a0ad5-0a4a-4a97-9d53-0dcb9f6d8bf6","phase":"B-0","attempt":1,"maxAttempts":3,"backoffMs":[100,300,900],"payload":{"phase":"queued","collisions":3,"processing_ms":1880,"guardrail":{"metric":"merge_auto_success_rate","observed":0.76,"tolerance_pct":5,"rollbackTo":"A-2"},"digest":"merge:storyboard:20250118"}}
```

上記 JSONL を Day8 `workflow-cookbook/scripts/analyze.py --dry-run` に入力すると、`payload.phase_step` や `payload.evaluation_ms` 欠損時に RED 判定となる。Analyzer は `tolerance_pct` を用いて ±5% SLO 逸脱を検知し、Reporter が `templates/alerts/rollback.md` の checklist (`Phase guard rollback`) に転記する。

## Analyzer 指標計算フロー

1. Collector は 15 分窓ごとに JSONL を正規化し、`flag_resolution` → `status.autosave` → `merge.trace` を相関 ID 単位で束ねる。
2. Analyzer は `flag_resolution` から `default_fallback_rate` を算出し、5% 超過で Rollback 候補フラグを立てる。
3. `status.autosave` の `latency_ms` から `autosave_p95` を算出。`phase_step='awaiting-lock'` の滞留率が 15% を超えた場合は Slack へ警告。
4. `merge.trace` は `processing_ms` P95 と `guardrail.observed` を比較し、`tolerance_pct` 超過時に `rollbackTo` を報告テンプレートへ出力。
5. Reporter は `reports/today.md` のロールバックチェックリストに `guard.rollbackTo`／`guardrail.rollbackTo` を追記し、Incident 票と整合させる。

## Rollback チェックリスト更新案

- [ ] `flag_resolution` の `evaluation_ms` が 15 分平均で +5% 以内か確認する。
- [ ] `status.autosave` の `phase_step='awaiting-lock'` 滞留率が 15% 未満であることを確認する。
- [ ] `merge.trace` の `guardrail.observed` が `tolerance_pct` を 2 バッチ以上超過していないこと。
- [ ] いずれかが逸脱した場合は `payload.guard.rollbackTo` または `payload.guardrail.rollbackTo` を実行計画に記録し、Reporter テンプレートへ貼り付ける。
