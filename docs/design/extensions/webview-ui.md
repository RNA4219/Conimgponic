# Webview UI 拡張設計

## 1. ビュー共通の状態遷移とメトリクス更新ポイント
| ビュー | 共有状態 | トリガー | 次状態/副作用 | メトリクス更新 | 根拠 |
| --- | --- | --- | --- | --- | --- |
| グリッド | `selectedCard`・`paneSync` | カードクリック | 右/下ペインへ詳細反映。スクロール位置を保持。 | タイトルバー AutoSave インジケータ更新。 | [UI-SPEC §2.1, §3, §4, §5](../../src-1.35_addon/UI-SPEC.md) |
| モザイク | `selectedCard`・`paneSync` | カードクリック／高さ測定完了 | 高さキャッシュ更新→右/下ペイン同期。 | AutoSave インジケータ、差分ハイライト。 | 同上 |
| タイムライン | `selectionRange`・`paneSync` | スクラブ/ズーム/範囲選択 | 選択範囲を下ペイン統合に送出。 | 統合ペインで採用時に履歴スナップショット。 | [UI-SPEC §2.3, §4, §5](../../src-1.35_addon/UI-SPEC.md) |
| カンバン | `columnStatus`・`selectedCard` | 列間D&D／クリック | 状態遷移→右/下ペイン同期。列ヘッダ WIP 数再計算。 | AutoSave インジケータ・列ヘッダ WIP カウント。 | [UI-SPEC §2.4, §4, §5](../../src-1.35_addon/UI-SPEC.md) |

- 全ビュー共通で `paneSync` は右（生成）・下（統合）ペインへの選択伝播を行う。
- AutoSave インジケータの更新は選択・編集・統合の副作用で共通化し、Collector/Analyzer へ指標を送出する。 [Day8 design](../../../Day8/docs/day8/design/03_architecture.md)

## 2. `status.autosave` 受信時の状態遷移
Phase 表（[IMPLEMENTATION-PLAN §0.2.2](../../IMPLEMENTATION-PLAN.md)）と `AUTOSAVE-DESIGN-IMPL` の状態マシンを統合した UI ステート。

| Phase | 受信イベント (`status.autosave.phase`) | UI 遷移 | インジケータ | テレメトリ送信 | 備考 |
| --- | --- | --- | --- | --- | --- |
| A (`disabled`) | `disabled` 固定 | Indicator 非表示、CTA 無効 | - | `ui.autosaveIndicator.hidden` | ガード継続監視。 |
| A-1 | `idle`→`debouncing`→`awaiting-lock`→`idle` | タイトルバーに ●→↻→↻→○ を表示。CTA 非表示。 | `●`/`↻`/`○` | `autosave.status` (`phase`,`retryCount`) | ロック警告はトーストのみ。 |
| B | 上記 + `backoff`/`retrying` | Retry CTA 表示、履歴ドロップダウン活性化。 | `↻` で点滅（バックオフ）。 | `autosave.retry`・`ui.autosaveIndicator.retryCta` | `.lock` フォールバック通知。 |
| C | 上記 + `error`/`halted` | 履歴 CTA を primary 強調、Diff Merge と連携。 | `●` 赤ハイライト | `autosave.failure`・`ui.autosaveIndicator.historyOpen` | 精緻マージ連携。 |

- `snapshot().phase` が `error` かつ `retryable=false` の場合は Phase C の UI でも即座に `disabled` へフェイルバックする。 [AUTOSAVE-DESIGN-IMPL §2.1](../../AUTOSAVE-DESIGN-IMPL.md)

## 3. UI 状態マシン
- ノード: `Idle` → `Dirty` → `Saving` → `Saved`。`Error` は `Retryable` と `Terminal` に分類。 [AUTOSAVE-DESIGN-IMPL §2.1](../../AUTOSAVE-DESIGN-IMPL.md)
- トリガー:
  - `input.changed` で `Dirty`。
  - `status.autosave.phase in {'debouncing','awaiting-lock','writing','updating-index','gc'}` で `Saving`。
  - `status.autosave.phase='idle'` & `lastSuccessAt` 更新で `Saved`。
  - `status.autosave.phase in {'backoff','retrying'}` で `Error(Retryable)`。
  - `status.autosave.phase in {'error','halted'}` で `Error(Terminal)`。
- `flushNow()` は即座に `Saving` へ遷移し、完了で `Saved` へ。 [AUTOSAVE-DESIGN-IMPL §2.1, Sequence](../../AUTOSAVE-DESIGN-IMPL.md)

## 4. イベントハンドラ
| イベント | 発火元 | ハンドラ | 副作用 |
| --- | --- | --- | --- |
| `input.changed` | 任意ビュー | `handleDirty()` | 状態 `Dirty`、デバウンス再起動。 |
| `status.autosave` | AutoSave Runner | `handleSnapshot(snapshot)` | ステート更新、CTA 表示制御、テレメトリ送信。 |
| `cta.retry` | Indicator | `flushNow()` | ロック再取得要求、`Retry` カウンタリセット。 |
| `cta.history` | Indicator | `openHistoryDrawer()` | 履歴一覧を読み込み、Collector へ `history-open`。 |
| `phase.toggle` | Flags | `applyPhaseConfig(phase)` | CTA/アクセシビリティ設定切替。 |

## 5. アクセシビリティ制約
- インジケータは `role="status"` とし、`aria-live="polite"` で状態変化を通知。 [UI-SPEC §6](../../src-1.35_addon/UI-SPEC.md)
- CTA ボタンは `aria-label` で Idle/Dirty/Saving/Saved を明示。色覚多様性のため、色だけに依存せずアイコン（●/○/↻）とテキストを併記。
- キーボード操作: Tab で Indicator → Retry → History にフォーカス移動。ショートカット `Ctrl+S` で `flushNow()` を発火しつつインジケータへフォーカスを返す。
- フォールバック時（Phase A）も不可視状態に `aria-hidden="true"` を付与し、スクリーンリーダーに重複通知させない。

## 6. テスト観点（`tests/webview/ui-indicator.spec.tsx`）
RED ケースとして以下を列挙。

| シナリオ | 初期状態 | イベント | 期待 UI | 備考 |
| --- | --- | --- | --- | --- |
| Idle 表示 | `phase='idle'` | 初期 snapshot | `○` 表示、CTA 非表示 | Phase A-1 以降 |
| Dirty 遷移 | `phase='idle'` | `input.changed` | `●` 表示、`aria-live` 更新 | 500ms デバウンス起動 |
| Saving 状態 | `phase='debouncing'` | snapshot | `↻` 表示、Retry CTA 非表示 | Phase A-1 |
| Saved 復帰 | `phase='gc'`→`idle` | snapshot | `○` 表示、履歴 CTA 活性 | `lastSuccessAt` 更新 |
| Retry 表示 | `phase='backoff'` | snapshot | `↻` 点滅、Retry CTA 表示 | Phase B |
| Terminal Error | `phase='error'` | snapshot | `●` 赤表示、履歴 CTA primary | Phase C |
| Phase ガード解除 | `phase='disabled'`→`idle` | flag toggle | Indicator 表示切替 | 二重ガード解除 |
| Phase ダウングレード | `phase='idle'` | flag revert | Indicator 非表示 (`aria-hidden`) | ロールバック確認 |

