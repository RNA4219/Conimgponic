# AutoSave Indicator UI 設計

本書は `AutoSaveIndicator.tsx` の UI 設計を確定し、`docs/AUTOSAVE-DESIGN-IMPL.md` の保存ポリシー・`Day8/docs/day8/design/03_architecture.md` のコンポーネント責務と整合させる。AutoSave ファサードが提供する `snapshot()` と `subscribeLockEvents()` を入力として、最小限のパネル追加で状態投影・履歴導線・アクセシビリティを担保する。

## 1. UI 構成図
```mermaid
flowchart TD
    subgraph AutoSaveIndicator Panel
        direction TB
        PhaseBadge[Phase 表示バッジ]
        StatusLine[最新保存時刻 / ステータスメッセージ]
        CTAGroup{CTA グループ}
        CTAHistory[[履歴ドロップダウンボタン]]
        CTARetry[[ロック再取得 / 再試行ボタン]]
        ErrorBanner[[エラー/ReadOnly バナー]]
    end
    PhaseBadge --> StatusLine --> CTAGroup
    CTAGroup --> CTAHistory
    CTAGroup --> CTARetry
    CTAGroup --> ErrorBanner
    AutoSaveCore[(snapshot())] --> PhaseBadge
    AutoSaveCore --> StatusLine
    LockStream[(subscribeLockEvents)] --> CTARetry
    LockStream --> ErrorBanner
    CTAHistory -->|click| HistoryDialog[(AutoSaveHistoryDialog)]
    CTARetry -->|user intent| LockRequest
```

- `PhaseBadge` は `snapshot().phase` を色分け表示し、既存ツールバーの右端に追加する（幅 240px 以内で既存操作と干渉させない）。
- `StatusLine` は `snapshot().lastSuccessAt` と `snapshot().pendingBytes` を整形し、保存の有無や `pendingBytes>0` をツールチップで提示する。
- `CTAGroup` では `History` / `Retry` / `Error` 表示を条件分岐し、既存ダイアログ導線（`AutoSaveHistoryDialog`）を流用する。

## 2. UI ステートチャート
`AutoSaveStatusSnapshot` の `phase` とロックイベントを UI 表示へ投影する。保存パイプラインは `docs/AUTOSAVE-DESIGN-IMPL.md`、
ロックハンドリングは Day8 ドキュメントのアーキテクチャ記述に沿って遷移制御する。

```mermaid
stateDiagram-v2
    [*] --> Disabled: phase='disabled'
    Disabled --> Idle: autosave enabled & dispose解除
    Idle --> Debouncing: phase='debouncing'
    Debouncing --> AwaitingLock: idle >= 2s
    AwaitingLock --> Writing: phase in {'writing-current','updating-index'}
    Writing --> GC: phase='gc'
    GC --> Idle: save pipeline completed
    AwaitingLock --> Idle: scheduler cancelled
    Idle --> Error: lastError present
    Debouncing --> Error: AutoSaveError surfaced
    Writing --> Error: AutoSaveError surfaced
    Error --> Idle: retryable && retry succeeds
    Error --> Disabled: dispose() or retryable=false
    Idle --> ReadOnly: lock.conflicted | lock.revoked
    ReadOnly --> Idle: lock.recovered | retry success
```

ReadOnly は `subscribeLockEvents` の通知でのみ遷移し、`phase='idle'` のままでも閲覧専用バナーを維持する。`retryable=false` のエラ
ーは `Disabled` 相当の扱いとし、履歴復元または再初期化でのみ復帰する。

## 3. 状態表示マトリクス
| phase (`snapshot().phase`) | lastError | retryable | 表示/挙動 | アナウンス文言 | CTA |
| --- | --- | --- | --- | --- | --- |
| `disabled` | - | - | グレーアウト、`Saved disabled` 表示。`StatusLine` は「自動保存は無効です」。 | `aria-live="polite"` で一度だけ通知。 | 履歴ボタンのみ。 |
| `idle` | 未設定 | - | グリーンバッジ、`Saved HH:MM`。 | 保存完了時に `aria-live` で「自動保存が完了しました」。 | 履歴ボタン活性。 |
| `debouncing` | 未設定 | - | ブルーバッジとスピナー、「保存待機中」。`pendingBytes` があればツールチップで残量表示。 | ライブ領域で変更せず視覚のみ。 | 履歴ボタン活性。 |
| `awaiting-lock` | 未設定 | - | アンバー表示「ロック取得中」。 | `aria-live` は使用せず、フォーカス時に説明テキスト。 | `Retry` 非表示、履歴ボタン disabled。 |
| `writing-current` / `updating-index` | 未設定 | - | パープル表示「保存中…」。プログレスバー（非決定型）。 | ライブ領域で一度だけ「保存を実行しています」。 | 履歴ボタン disabled。 |
| `gc` | 未設定 | - | 同上色で「履歴整理中」。 | スクリーンリーダー向けに `aria-busy=true`。 | 履歴ボタン disabled。 |
| 任意 | `AutoSaveError` | `true` | 赤バッジ＋エラーバナー「自動保存エラー（再試行可）」。 | `aria-live="assertive"` で直ちに読み上げ。 | `Retry` ボタン活性、履歴ボタンは secondary。 |
| 任意 | `AutoSaveError` | `false` | 赤バッジ＋「再試行できません。履歴から復元してください」。 | assertive 通知。 | `Retry` 非表示、履歴ボタン primary 強調。 |
| 任意 | `lastError` 未設定 かつ `subscribeLockEvents` `conflicted` | - | 上部に `ErrorBanner`「別セッションが編集中」。 | assertive。 | 履歴ボタンはフォーカスファースト、`Retry` は read-only 解除で表示。 |

- `PhaseBadge` と `StatusLine` は 4 秒ごとに `snapshot()` を再描画するポーリング（`requestAnimationFrame` 依存の軽量更新）で実装し、`AUTOSAVE_DEFAULTS` のデバウンス/アイドル設定と整合させる。
- `subscribeLockEvents` により `lock.conflicted` と `lock.revoked` を補足し、`snapshot().phase` が `idle` でも ReadOnly への遷移を示す。

## 4. Props / イベント契約
`src/lib/autosave.ts` の facade から得られる操作を props で受け取り、UI 層は副作用を持たずに状態投影する。

```ts
export interface AutoSaveIndicatorProps {
  readonly snapshot: AutoSaveStatusSnapshot;
  readonly isReadOnly: boolean; // lock.conflicted / lock.revoked を集約
  readonly onRequestFlush: () => Promise<void>; // flushNow() デリゲート
  readonly onRequestRetry: () => void; // retryable error → 再試行
  readonly onOpenHistory: () => void; // 履歴ダイアログ起動
  readonly telemetry?: (event: AutoSaveIndicatorEvent) => void;
  readonly ariaLabelledBy?: string;
}

type AutoSaveIndicatorEvent =
  | { type: 'phaseChanged'; from: AutoSavePhase; to: AutoSavePhase; retryCount: number }
  | { type: 'errorShown'; code: AutoSaveErrorCode; retryable: boolean; sourcePhase: AutoSavePhase }
  | { type: 'historyOpened'; trigger: 'badge' | 'banner' }
  | { type: 'retryRequested'; trigger: 'cta' | 'banner' }
  | { type: 'flushRequested' };
```

- `snapshot` は `initAutoSave().snapshot()` の戻り値をそのまま提供し、コンポーネント内では読み取り専用で扱う。
- `isReadOnly` は `subscribeLockEvents` 由来のステータスを `AppAutoSaveRunner` 層で統合して渡す。
- `onRequestFlush` は手動保存ボタン（ReadOnly 以外）で使用し、完了まで `aria-busy` を設定する。
- Telemetry は Collector の `ui.*` 名前空間を継承し、呼び出し元でレート制御を実施する。

## 5. アクセシビリティ要件
- `PhaseBadge` と `StatusLine` を `role="status"`・`aria-live` で適切に分類（`idle`/`error` は `assertive`、その他は `polite`）。
- バナー/CTA は `aria-controls` で `AutoSaveHistoryDialog` に関連付け、キーボードフォーカスが履歴ボタンに優先移動する。
- `Retry` ボタンは `lastError.retryable` が true のときのみ DOM にレンダリングし、フォーカス順序を保つ。
- 色覚補助: 色のみで状態を伝えないため、フェーズごとにアイコンラベル（例: `idle`=チェック、`error`=警告）を含める。

## 6. 履歴アクセス導線
1. 履歴ボタンは常時表示（`awaiting-lock`/`writing-current`/`gc` は `disabled` 属性）。
2. `ErrorBanner` 表示中は履歴ボタンに `data-emphasis="primary"` を付与し、Collector 連携で `ui.autosaveIndicator.historyOpened` を送信する。
3. ReadOnly 中 (`lock.conflicted`) はバナーの `Override` アクションから `LockRequest` を再送し、成功後にフォーカスを履歴ボタンへ戻す。

## 7. Telemetry 契約
| UI アクション | Telemetry 名 | Payload |
| --- | --- | --- |
| フェーズ更新 | `ui.autosaveIndicator.phaseChanged` | `{ fromPhase, toPhase, retryCount }` |
| エラー発生 | `ui.autosaveIndicator.errorShown` | `{ code, retryable, sourcePhase }` |
| 履歴ダイアログ表示 | `ui.autosaveIndicator.historyOpened` | `{ trigger: "badge" | "banner" }` |
| リトライ | `ui.autosaveIndicator.retry` | `{ source: "banner" | "cta" }` |
| 手動保存 | `ui.autosaveIndicator.flush` | `{ pendingBytes, fromPhase }` |

Collector では `ui.*` 名前空間を維持し、Payload は既存 schema の `reason`/`variant` キーと互換フィールドを再利用する。

## 8. 先行テストケース仕様（`tests/components/AutoSaveIndicator.test.tsx`）
| No. | シナリオ | モック設定 | 期待挙動 |
| --- | --- | --- | --- |
| 1 | `snapshot().phase='idle'` 更新 | `lastSuccessAt` を固定し `subscribeLockEvents` なし | バッジ `Saved HH:MM` と `aria-live` polite が発火。 |
| 2 | `phase='awaiting-lock'` → `writing-current` | `snapshot()` を逐次差し替え、ロックイベント無し | 履歴ボタン disabled、スピナー表示、ライブ領域未更新。 |
| 3 | `phase='idle'` + `lock.conflicted` イベント | `subscribeLockEvents` モックで `conflicted` を発行 | ReadOnly バナー表示、履歴ボタンに primary 強調。 |
| 4 | `lastError.retryable=true` | `snapshot().lastError` にモックエラー | Retry ボタン表示、クリックで `onRequestRetry` が呼ばれる。 |
| 5 | `lastError.retryable=false` | 同上 | Retry ボタン非表示、履歴 CTA が primary。 |
| 6 | 手動 flush ボタン押下 | `onRequestFlush` を Promise 解決待ち、`phase='debouncing'` | ボタン押下で `aria-busy`、完了後 `phaseChanged` Telemetry。 |
| 7 | `phase='gc'` 中の履歴アクセス | `snapshot()` が `gc` を返却 | 履歴ボタン disabled、`aria-busy` 属性が付与。 |
| 8 | Telemetry 発火 | `phase` 遷移とボタンクリックを再現 | 遷移時に `phaseChanged`、履歴/リトライ/flush 押下でイベント送信。 |

テストでは AutoSave ファサードをモックし、React Testing Library で `AutoSaveIndicator` の再描画とアクセシビリティ属性を検証する。`mypy/strict`・`ruff`・`node:test` 規約を満たすため、型定義とイベントハンドラの API は公開型を変更せずにスタブ化する。
