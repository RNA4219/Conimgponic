---
intent_id: INT-001
owner: your-handle
status: active   # draft|active|deprecated
last_reviewed_at: 2025-10-21
next_review_due: 2025-11-21
---

# Runbook

## Environments

- Local / CI / Prod の差分（キー名だけ列挙）

## Execute

- 準備 → 実行 → 確認（最短手順）
- 例）
  - 準備: データ投入 / キャッシュ初期化
  - 実行: コマンド/ジョブ名
  - 確認: 出力の存在・件数・整合

## Observability

- ログ/メトリクスの確認点、失敗時の兆候（[ADR-021: メトリクスと可観測性の統合](docs/ADR/ADR-021-metrics-observability.md) を参照）
- インシデント発生時は docs/IN-YYYYMMDD-XXX.md に記録し、最新サンプル（[IN-20250115-001](docs/IN-20250115-001.md)）を参照して検知し、ログ・メトリクスの抜粋を添付
- QA メトリクス収集と確認
  - `python tools/perf/collect_metrics.py --suite qa --output .ga/qa-metrics.json` を実行し、最新の QA メトリクスを取得する。
  - `.ga/qa-metrics.json` はリポジトリルート配下に生成される。CI で Metrics Harvest が検出できるようファイル名・パスを変更しない。
  - `python - <<'PY'` → `import json; data=json.load(open('.ga/qa-metrics.json', encoding='utf-8'));
     print({k: data[k] for k in ('compress_ratio', 'semantic_retention')})` で、
    `compress_ratio` と `semantic_retention` の値を抽出する。
  - 合格レンジ: `compress_ratio` は `0.55` 以上 `0.75` 以下、`semantic_retention` は `0.93` 以上。
    外れた場合は直近成功値との差分を記録し、再現条件を含めて共有する。
- 失敗兆候と一次対応
  - `.ga/qa-metrics.json` が生成されない / 壊れている: `python tools/perf/collect_metrics.py --help` で、
    オプションを再確認し、再実行前にキャッシュディレクトリを削除。
  - メトリクス値が合格レンジ外: Chainlit ログ（例: `~/.chainlit/logs/*.log`）で入力プロンプトやレスポンス異常を確認し、
    必要に応じて再試行ジョブをトリガー。
  - コマンドエラーやタイムアウト: 依存ライブラリ不足の警告を確認し、仮想環境へ不足モジュールを再インストールしてから再実行。

## Confirm

- Execute 結果を主要メトリクス・アウトプットと突き合わせ、`CHECKLISTS.md` の [Hygiene](CHECKLISTS.md#hygiene) で整合性と未完了項目を再確認
- インシデント記録を [docs/INCIDENT_TEMPLATE.md](docs/INCIDENT_TEMPLATE.md) に沿って初動報告→確定記録まで更新し、関連 PR / チケットへリンクを共有
- `Observability` で検知したアラート・兆候の解消を運用チャネルへ報告し、残るフォローアップを RUNBOOK / docs/IN-YYYYMMDD-XXX.md に追記

## Rollback / Retry

- どこまで戻すか、再実行条件
- インシデントサマリを更新後、該当PRの説明欄と本RUNBOOKの該当セクションにリンクを追加する
