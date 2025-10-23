# AutoSave フラグ試験計画

## 0. TDD 手順
1. `tests/autosave/scheduler.spec.ts` に Fake タイマーを使ったフェーズ遷移テストを追加し、`AUTOSAVE_PHASE_DESCRIPTIONS`/`AUTOSAVE_STATE_TRANSITION_MAP` の `idle → debouncing → awaiting-lock` を先に赤→緑で確認する。
2. `tests/autosave/history.spec.ts` で `__mocks__/opfs.ts` を用意し、`AUTOSAVE_HISTORY_ROTATION_PLAN` に沿った FIFO/容量制約を失敗ケースから実装する。
3. `tests/autosave/locks.spec.ts` にロックモックを追加し、`AUTOSAVE_CONTROL_RESPONSIBILITIES` の `flushNow`/`dispose` が適切にバックオフ・停止することを検証してから本体を実装する。
4. `tests/autosave/restore.spec.ts` で `AUTOSAVE_ERROR_NOTIFICATION_FLOWS` を参照しつつ `data-corrupted` を先に再現、その後に正常復元を実装する。
5. 以上のユニットを統合する前に `tests/autosave/init.spec.ts` で `AUTOSAVE_DISABLED_CONDITIONS` の 3 条件を再現し、副作用ゼロを保証する。

## 1. スコープと目的
- 対象: `autosave.enabled` フラグ ON/OFF 両系統のユニット/統合試験。
- 目的: AutoSave ランナー起動、ロック制御、OPFS 書き込み、復旧パスの機能安全性を確認し、Phase A ロールアウト判断に足る証跡を確保する。

## 2. テストケーステンプレート
| 項目 | 記入ルール |
| --- | --- |
| Test ID | `AS-{層}-{連番}` (`U`=ユニット, `I`=統合) |
| Flag State | `ON` / `OFF` を明記し、切替手段（env/localStorage）を列挙 |
| Preconditions | モック依存関係（lock API, OPFS, 時刻）と初期ストーリーボードの状態 |
| Steps | `Given/When/Then` 形式で最大 3 手順に分解 |
| Expected Result | 成否条件 + 監査ログ/イベントの検証観点 |
| Snapshot | 要/不要。必要な場合は差分許容範囲を定義 |

### ケース一覧
| Test ID | Flag State | 概要 |
| --- | --- | --- |
| AS-U-01 | OFF (`import.meta.env=false`) | 既存手動保存のみが呼ばれ AutoSave 起動副作用がないことを確認 |
| AS-U-02 | ON (`import.meta.env=true`) | AutoSave ランナーが `acquireProjectLock` を呼び出す起動テスト |
| AS-U-03 | ON (`localStorage=true`) | env false でもローカル設定で上書きされることの優先順位検証 |
| AS-I-01 | OFF | 強制終了→再起動で AutoSave 復旧フローが発火しないことを確認 |
| AS-I-02 | ON | Idle 2s 後に OPFS 書き込みが行われ、Collector へイベント送信が行われる |
| AS-I-03 | ON (ロック衝突) | Web Lock 失敗→フォールバック `.lock` 取得の再試行シナリオ |
| AS-I-04 | ON (`flushNow`) | `flushNow()` が `idle`/`debouncing` から即座に `awaiting-lock` へ遷移する |
| AS-I-05 | ON (dispose) | 書込フライト中に `dispose()` が呼ばれても `current.json`/`index.json` が整合する |

## 3. I/O コントラクト
```typescript
export interface MockStoryboard {
  projectId: string;
  scenes: Array<{
    id: string;
    updatedAt: string; // ISO8601
    frames: number;
  }>;
}

export interface AutoSaveTestInput {
  flag: {
    envValue?: boolean;
    localStorageValue?: boolean;
  };
  storyboard: MockStoryboard;
  clock: {
    now: () => number; // ms since epoch
    advanceBy: (ms: number) => void;
  };
  locks: {
    web: MockWebLock;
    fallback: MockFileLock;
  };
}

export interface AutoSaveExpectation {
  lockSequence: Array<'web:acquire' | 'web:fail' | 'file:acquire' | 'release'>;
  writes: Array<{ path: string; payload: MockStoryboard }>;
  telemetry: Array<AutoSaveTelemetryEvent>;
  snapshotKey?: string;
}
```
- `MockWebLock`/`MockFileLock` は再試行可否 (`retryable: boolean`) を含め既存エラー分類へ揃える。
- `AutoSaveTelemetryEvent` は `feature: 'autosave'` と `phase` を必須とし、Collector 側の JSONL スキーマ互換を担保する。

## 4. スナップショット戦略
- AutoSave 書き込み結果は `writes[n].payload` を JSON 整形後に保存。`projectId` とシーン順序を固定し、非決定値（timestamp）はモック時計から生成。
- ロックイベントは `lockSequence` をスナップショット化し、フォールバック発動有無を一目で比較できるようにする。
- 既存スナップショットとの互換維持のため、新規キーは `autosave.enabled` の状態別ディレクトリ（`__snapshots__/autosave/on|off`）に分離する。

## 5. モックデータ設計
- `MockStoryboard` のデフォルト: 3 シーン構成（`intro`/`conflict`/`resolve`）、`updatedAt` は過去 5 分以内を想定。
- ロック衝突テストでは `MockWebLock` に `fails: ['already-held']` を設定し、フォールバックでは UUID と TTL を検証。
- 復旧テスト用に `project/autosave/history.jsonl` を 2 レコード分生成し、最新レコードのみ適用されることを確認する。

### 5.1 OPFS ローテーションスタブ

| API | 役割 | 実装方針 |
| --- | --- | --- |
| `writeCurrent` | `current.json.tmp` → rename の模倣 | `InMemoryOpfs` 上で `current.tmp` キーに書込み後、`rename()` で `current` へ差し替える。`bytes` は `JSON.stringify(payload).length` を返す。 |
| `updateIndex` | `index.json` の構築 | 最新世代を先頭に unshift し、`maxGenerations` 超過分を末尾から削除。整合しないときは `AutoSaveError('history-overflow')` を投げる。 |
| `rotateHistory` | 履歴ファイル管理 | `history/<ts>.json` を map 化し、`AUTOSAVE_HISTORY_ROTATION_PLAN.gcOrder` に従って FIFO で削除。`options.enforceBytes` 指定時は合計サイズを再計算し、50MB 超過分を削除。 |

`tests/autosave/__mocks__/opfs.ts` で上記 API を提供し、`beforeEach` で `reset()` を行う。容量は `Map<string, number>` で保持し、`cleanupOrphans` を検証する際は `history` ディレクトリの孤児キーを自動削除する。

## 6. CI コマンド順序
1. `pnpm lint` — ruff 相当の静的解析（※Node 環境で ESLint 代替として設定予定）。
2. `pnpm typecheck` — `tsc --noEmit` を想定。
3. `pnpm test --filter autosave` — Node Test Runner で AutoSave 系のユニット/統合を順次実行。
4. `pnpm test -- --test-coverage` — 回帰時のスナップショット更新前に全体の差分を確認。

## 7. 状態遷移カバレッジ

`AUTOSAVE_STATE_TRANSITION_MAP` の各遷移を以下で網羅する。

| Transition | 対応テスト | 備考 |
| --- | --- | --- |
| `disabled -> idle (init)` | `tests/autosave/init.spec.ts` `AS-U-02` | Feature flag ON の初期化。 |
| `idle -> debouncing` | `tests/autosave/scheduler.spec.ts` `change event` | Fake タイマーで検証。 |
| `idle -> awaiting-lock (flushNow)` | `tests/autosave/scheduler.spec.ts` `flushNow` | 手動保存でアイドル待機をスキップ。 |
| `debouncing -> awaiting-lock` | 同上 | `idle-confirmed` シーケンス。 |
| `debouncing -> awaiting-lock (flushNow)` | `tests/autosave/scheduler.spec.ts` `flushNow` | デバウンスキャンセル経由。 |
| `awaiting-lock -> writing-current` | `tests/autosave/scheduler.spec.ts` `lock success` | ロックモック成功。 |
| `awaiting-lock -> debouncing (lock-retry)` | `tests/autosave/scheduler.spec.ts` `lock retry` | バックオフ回数を snapshot。 |
| `awaiting-lock -> error (flight-error)` | `tests/autosave/locks.spec.ts` (新規) | `retryable=false` ケース。 |
| `writing-current -> updating-index` | `tests/autosave/history.spec.ts` `write commit` | `writeCurrent` 成功。 |
| `writing-current -> error` | `tests/autosave/history.spec.ts` `write failure` | OPFS スタブで例外。 |
| `updating-index -> gc` | `tests/autosave/history.spec.ts` `index commit` | FIFO 実行。 |
| `updating-index -> error` | 同上 | index 更新失敗。 |
| `gc -> idle` | `tests/autosave/history.spec.ts` `gc complete` | 容量制限完了。 |
| `error -> awaiting-lock (retry)` | `tests/autosave/scheduler.spec.ts` `retryable error` | バックオフ後に復帰。 |
| `* -> disabled (dispose)` | `tests/autosave/init.spec.ts` `dispose` | フェーズ別にパラメタ化。 |

## 8. 例外ハンドリング確認ポイント

- `AutoSaveError(code='disabled')` は `initAutoSave` の戻り値でのみ使用し、テレメトリ記録を行わない。
- `code='lock-unavailable'` で 5 回連続失敗した場合は `phase='error'` + `retryable=false` に降格することをアサート。
- `code='write-failed'` で `cause.name==='NotAllowedError'` の場合は即時停止し、再試行を行わない。
- `code='data-corrupted'` は復元 API 系でのみ発生させ、`restorePrompt()` が `null` を返すことを確認。

## 9. テレメトリ検証

`AutoSaveTelemetryEvent` の `feature` 固定値・`phase` 列挙の網羅性を以下で担保する。

| Phase | テスト | チェック内容 |
| --- | --- | --- |
| `debouncing` | `scheduler.spec.ts` `change event` | `detail.pendingBytes` が設定される。 |
| `awaiting-lock` | `locks.spec.ts` `lock retry` | `retryCount` を detail に含める。 |
| `writing-current` | `history.spec.ts` `write commit` | `detail.bytes` を確認。 |
| `gc` | `history.spec.ts` `gc complete` | 削除世代数を detail に含める。 |
| `error` | `locks.spec.ts` `retry exhaustion` | `detail.code` と `retryable` を確認。 |

## 10. タスク Seed

| ID | タイトル | Owner | ステップ |
| --- | --- | --- | --- |
| AS-TDD-01 | initAutoSave scheduler のデバウンス/アイドル制御を実装 | backend | 1) `tests/autosave/scheduler.spec.ts` にデバウンス完了シナリオを追加<br>2) Fake タイマーで `flushNow` がアイドル待機をスキップすることを検証<br>3) 実装した状態遷移が `AUTOSAVE_STATE_TRANSITION_MAP` に一致することを確認 |
| AS-TDD-02 | OPFS 書き込みと履歴ローテーションの実装 | backend | 1) `tests/autosave/history.spec.ts` に FIFO/容量制限ケースを作成<br>2) `InMemoryOpfs` を実装し `writeCurrent`/`updateIndex`/`rotateHistory` を検証<br>3) `AUTOSAVE_HISTORY_ROTATION_PLAN` とメタデータ整合性を確認 |
| AS-TDD-03 | 復元 API 群の実装と破損検知 | backend | 1) `tests/autosave/restore.spec.ts` に `data-corrupted` エラーケースを追加<br>2) `restorePrompt`/`restoreFromCurrent`/`restoreFrom` の正常系を追加<br>3) `AutoSaveError(code="data-corrupted")` の `retryable=false` をアサート |
| AS-QA-01 | AutoSave Telemetry 検証シナリオ | qa | 1) `tests/autosave/init.spec.ts` で feature flag ON/OFF のテレメトリ差分を記録<br>2) Collector イベントが `AutoSaveTelemetryEvent` と一致するかを確認<br>3) `retryCount>=3` で単一ログのみ出力されることを確認 |
