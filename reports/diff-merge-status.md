# Diff Merge / AutoSave 実装レビュー

## 参照前提
- `docs/IMPLEMENTATION-PLAN.md`: Phase 別ロールアウトとゲートコマンド、Diff タブ露出条件を段階管理する基準を定義。
- `docs/CONFIG_FLAGS.md`: `autosave.enabled` / `merge.precision` の入力優先順位と配布手順を整理し、フラグのソース整合性を監査するためのマトリクスを提供。

## 実装レビュー
### 全体構成
- `docs/IMPLEMENTATION-PLAN.md` の Phase A/B/C 進行と Diff タブ展開条件は、現行 `src/components/MergeDock.tsx` の `resolveMergeDockPhasePlan` 判定に概ね反映。ただし Phase C で要求される `stable` 移行チェックリスト（テレメトリ完了・UI バナー撤去）の進捗記録が欠落している。
- `docs/CONFIG_FLAGS.md` が定義する `autosave.enabled`・`merge.precision` の優先順位は `src/components/MergeDock.tsx` の `getEffectivePrecision` と `shouldEnableDiffInteraction` で実装。`env` → `workspace` → `localStorage` → `default` の評価順を維持している一方で、Phase 切替時に Collector へ `flag_resolution` を送る仕組みは `createMergeEventHub` にログ出力があるのみで未接続。

### AutoSave 連携
- `docs/MERGE-DESIGN-IMPL.md` が規定する AutoSave 協調は `startMergeDockAutoSaveHeartbeat` と `attachAutoSaveLockEvents` により達成済みで、Diff 適用前に `createAutoSaveLease` を確保する実装も存在。
- Phase B で求められる `historyBoost` 加算・`flushNow()` 強制トリガは `commitMergeResult` へ未組込み。AutoSave 履歴との連携は途中段階。
- エラー処理は `docs/MERGE-DESIGN-IMPL.md` の `retryable`/`fatal` 分類と整合し、`DiffMergeQueueEvent` の `retryable` 分岐で再試行 UI を提示。ただし `fatal` ケースのテレメトリ送信は `TODO`。

### UI / Precision 切替
- Diff タブ表示制御は `shouldRenderDiffBackupCTA` と `shouldEnableDiffInteraction` に集約され、`docs/MERGE-DESIGN-IMPL.md` の precision 表に沿って `beta` バッジ表示と末尾配置を実現。
- `beta` → `legacy` ロールバック時のタブ復元は `persistMergeDockActiveTab` が `localStorage` を参照し `docs/CONFIG_FLAGS.md` の `FlagSnapshot` 仕様と整合。ただし復元後のバッジ非表示を検証する UI テストが未整備。
- Precision 手動切替 UI (`renderPrecisionSelector`) は `beta` 以上で有効化され、Phase C で要求される `stable` デフォルト切替は feature flag での上書き待ち状態。

### テレメトリ / ロギング
- `createMergeEventHub` は Diff 選択や AutoSave ロックイベントを発火するが、`docs/MERGE-DESIGN-IMPL.md` が求める `precision_mode_change`・`autosave_lock_duration` 計測はフック未実装。Phase B の完了要件に対する証跡が不足。
- `docs/CONFIG_FLAGS.md` の `distribution.audit` 方針に合わせたフラグ配布ログは UI 層で取得されておらず、`flag_resolution` ブレッドクラム挿入の `TODO` が残る。

### 既知ギャップ
- AutoSave 履歴ブースト、Diff タブロールバック UI テスト、Collector 連携テレメトリなど Phase B 以降のチェック項目が未達。総合的に Phase A 完了 / Phase B 途中という進捗評価。

> 引用: `docs/MERGE-DESIGN-IMPL.md` の precision 別スコアリング表は `beta` の `auto=clamp(profile.threshold+0.05, 0.8, 0.92)` などを明記し、Diff タブを末尾表示し `Beta` バッジを付与する運用を要求。
>
> 引用: `src/components/MergeDock.tsx` の `createMergeEventHub` 実装は Diff マージ決定イベントを購読者へ配布し、`DiffMergeQueueEvent` ハブが AutoSave 連携を含むキュー制御を担っている。

## タスク案
- [ ] Phase B precision ガード監査
  - `docs/IMPLEMENTATION-PLAN.md` の Phase B チェックリストと `docs/CONFIG_FLAGS.md` のアクティベーションマトリクスに沿い、`merge.precision=beta/stable` 選択時の Diff タブ露出と `autosave.enabled` の同時有効条件を検証するテストケースを起票。
  - 現状コード: `src/components/MergeDock.tsx` の `shouldEnableDiffInteraction` が `autosave.enabled` と precision を同時評価しているが、`beta` → `legacy` ロールバック時のタブ保持検証が未整備。
- [ ] Diff Merge UI 実装進捗の可視化
  - `docs/MERGE-DESIGN-IMPL.md` が要求する `queueMergeCommand('auto-apply')` 成功時の AutoSave `flushNow()` トリガとテレメトリ送信が `DiffMergeQueueEvent` で完結しているかを確認し、進捗レポートを作成。
  - `src/components/MergeDock.tsx` では `createAutoSaveLease` や `attachAutoSaveLockEvents` が存在するものの、Diff タブにおける `retryable` 判定の可視化が部分的。進捗割合（例: UI バナー連携 60%）を整理。
- [ ] コード実装トラッキング
  - `docs/IMPLEMENTATION-PLAN.md` のテスト駆動原則に基づき、`MergeDock` 周辺の Jest/Vitest（`node:test`）シナリオを拡充するタスクリストを WBS へ追加。
  - `docs/CONFIG_FLAGS.md` の `FlagSnapshot` 仕様と `src/components/MergeDock.tsx` のタブ復元挙動を照合し、既存実装との差分（例: `localStorage.merge.lastTab` フォールバック）の進捗を記録。
