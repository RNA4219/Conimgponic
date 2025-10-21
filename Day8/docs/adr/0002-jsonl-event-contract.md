# ADR 0002: JSONL イベント契約と Analyzer 連携

- **ステータス**: Accepted
- **作成日**: 2025-10-31
- **レビュアー**: @collector-owner, @data-quality
- **関連チケット/タスク**: docs/TASKS.md#telemetry, workflow-cookbook/CHECKLISTS.md#quality

## 背景
- Katamari では CI 実行ログを JSONL として収集し、Analyzer がストリーム処理しやすいフォーマットに統一していた。
- Day8 でも Collector が複数の CI ワークフローからログを受け取るが、フォーマットが揃っていないと Analyzer が例外で停止し、Reporter が参照できなくなる。
- `/healthz` と MetricsRegistry の整合性を確保するため、ログの欠損やフィールド追加があった場合に Analyzer が検知できる仕組みが必要になった。

## 決定
- Collector は以下の JSONL スキーマを必須とする：

  ```json
  {
    "ts": "ISO8601",          // イベント発生時刻 (UTC)
    "name": "pytest::suite",  // テストまたはタスクの識別子
    "status": "passed|failed|skipped|errored",
    "duration_ms": 1234,       // 実行時間 (ミリ秒)
    "payload": {               // 任意の追加情報（例: stderr サマリ、retry flag）
      "source": "gha|manual",
      "retryable": true
    }
  }
  ```

- 追加フィールドは `payload` にネストし、トップレベルの互換性を維持する。
- Analyzer はスキーマ検証を実行し、欠落フィールドがある行を隔離ログ（`workflow-cookbook/logs/invalid/`）へ退避した上で処理を継続する。
- Collector は JSONL 生成後に sha256 チェックサムを計算し、`workflow-cookbook/logs/.checksums` に記録する。Analyzer はチェックサムを検証し、破損を検知した場合は再処理を要求する。
- Reporter は Analyzer が生成した中間成果物に対してのみ依存し、生ログには触れない。

## 根拠
- JSONL はストリーム処理が容易で、Katamari でも再利用実績がある。
- `payload` ネストにより後方互換性を保ちながらメタデータを拡張できる。
- チェックサム検証を行うことで、CI の断続的な I/O 障害を早期に検知できる。

## 影響
- Collector 実装は JSONL スキーマに準拠するためのバリデーションを組み込む必要がある。
- Analyzer と Reporter の実装は本スキーマを前提としてテストケースを更新する。
- `docs/day8/design/03_architecture.md` と `docs/day8/ops/04_ops.md` はログフローの説明に本 ADR をリンクする。
- Birdseye index/caps を更新し、Collector → Analyzer の依存が ADR 0002 に紐づくことを示す。

## フォローアップ
- [ ] JSON スキーマ定義を `workflow-cookbook/schemas/collector.json` として整備し、本 ADR から参照する。
- [ ] Analyzer のユニットテストに invalid ログの隔離パスを追加する。
