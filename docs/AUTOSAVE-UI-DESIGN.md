# AutoSave UI フロー設計

## 1. AutoSave ファサード API 利用整理
- `initAutoSave(getStoryboard, options)` でランナーを起動し、`snapshot()` により `AutoSaveStatusSnapshot` を Pull 監視する。
  - `phase` は [状態マップ](../src/components/AutoSaveIndicator.tsx) のキーと一致し、`lastSuccessAt` や `retryCount` を UI メタ情報として表示する。
  - `flushNow()` は手動保存（Ctrl+S 相当）から呼び出し、`debouncing`/`idle` フェーズでも 2s アイドル待ちをスキップして `awaiting-lock` → `writing-current` へ遷移させる。
  - `dispose()` はタブクローズやフラグ OFF 切替で呼び出し、`phase='disabled'` のスナップショットへ戻る。Collector への余計なイベントを避けるため 1 回だけ呼び出す。
- 履歴 API は UI 側で次の順に利用する。
  1. Indicator から `listHistory()` を呼び出し、`index.json` の降順リストを取得してサマリを表示する。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L182-L189】
  2. ユーザーが復元を選択した場合、`restoreFrom(ts)` で特定世代を読み込み、成功時は `snapshot()` が `idle` に戻るのを確認する。
  3. 直前クラッシュ復帰時は `restorePrompt()` → `restoreFromCurrent()` の順に実行し、破損検知 (`data-corrupted`) は UI ダイアログで通知する。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L70-L120】
- `snapshot` 経由で得た `queuedGeneration` を履歴リストのハイライトに使い、GC 後に削除された世代は UI 側で自動的に除外する。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L210-L224】

## 2. AutoSave Indicator 表示・操作フロー
- Indicator は `snapshot().phase` から [AUTOSAVE_PHASE_STATE_MAP](../src/components/AutoSaveIndicator.tsx) を参照し、ラベル・説明文・履歴操作の可否を決定する。
- フロー概要:
  1. `disabled` → 設定ガード。履歴 UI は完全に隠す。
  2. `idle` → 履歴ボタンを有効化し、`lastSuccessAt` を更新時刻として表示。
  3. `debouncing` → 保存予定を表示しつつ履歴操作は維持。`pendingBytes` が存在すればサイズ表示。
  4. `awaiting-lock`/`writing-current`/`updating-index`/`gc` → 保存中フェーズ。ロック競合・履歴整合中に操作をブロックする。
  5. `error` → `lastError` と `retryCount` を表示し、履歴復元を推奨するためボタンを再び有効化。
- `snapshot()` 監視は `requestAnimationFrame` ではなく `setInterval(500ms)` の Pull で十分。フェーズ遷移ごとに `aria-live` を `polite` / `assertive` で切り替え、アクセシビリティ通知を確実にする。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L161-L189】
- GC 完了 (`phase='idle'`) 後に `listHistory()` を再フェッチして UI キャッシュと `index.json` の整合を取る。FIFO 削除や容量超過解消は Indicator の履歴ノートにも表示する。【F:docs/AUTOSAVE-DESIGN-IMPL.md†L208-L224】

## 3. UI テレメトリ設計
- Collector へのイベントは `autosave.ui.*` プレフィックスで統一し、Implementation Plan の命名規約チェックリストに従う。【F:docs/IMPLEMENTATION-PLAN.md†L119-L136】
- 収集指標とイベント:
  | Event 名 | トリガー | Collector メトリクス | 備考 |
  | --- | --- | --- | --- |
  | `autosave.ui.phase_change` | `snapshot().phase` が変化した時 | 保存フェーズ滞留時間 (P95) | `properties.phase` と `retryCount` を送信し、Collector→Analyzer の SLA 判定に利用 |
  | `autosave.ui.history_open` | 履歴ボタン押下 | 履歴利用率 | `properties.phase_before` でアクセス時の状態を記録 |
  | `autosave.ui.restore_request` | `restoreFrom(ts)` 実行直前 | 復元成功率 | `properties.source` に `current`/`history` を保持 |
  | `autosave.ui.restore_result` | 復元 API 完了時 | 復元成功率/失敗率 | `properties.success` と `error.code` を付与 |
  | `autosave.ui.error_banner` | `lastError` を表示した時 | ユーザー通知数 | `properties.code` が Implementation Plan の SLO レポートに統合される |
- 各イベントは 1 アクション 1 レコードを厳守し、既存 Day8 Observability チャネルと衝突しないよう `feature:"autosave"` タグを付ける。【F:docs/IMPLEMENTATION-PLAN.md†L137-L175】
- Monitor スクリプトが 15 分間隔で収集する保存時間/復元率メトリクスと整合するよう、UI 送信時刻は ISO8601 で記録し、Collector 側で `reports/monitoring/` の JSONL と結合できるフォーマットとする。【F:docs/IMPLEMENTATION-PLAN.md†L92-L118】
