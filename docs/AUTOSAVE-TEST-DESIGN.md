# AutoSave テスト基盤設計

## 1. 目的と前提
- `src/lib/autosave.ts` の実装要件および保存ポリシーは [AutoSave 実装詳細](./AUTOSAVE-DESIGN-IMPL.md) に従う。
- Collector/Analyzer/Reporter との疎結合とイベントフローは [Day8 Architecture](../Day8/docs/day8/design/03_architecture.md) を参照し、副作用が CI パイプラインのログ収集を妨げないことを前提とする。
- テスト環境は TypeScript (ESM) + `node:test` + `ts-node` 実行を想定し、`mypy/strict`・`ruff` は Python コンポーネント向けに別途維持する。

## 2. テスト対象コンポーネント
| コンポーネント | 役割 | テスト観点 |
| --- | --- | --- |
| AutoSaveScheduler | デバウンスとアイドル判定で保存ジョブを制御 | Fake Timer による時間経過制御、連続入力時の保存抑制 |
| OpfsPersistence | OPFS への current/index/history 書込と GC | InMemory OPFS スタブを用いた原子的更新、容量超過時の FIFO 削除 |
| HistoryCatalog | 履歴メタデータ管理と復元 API | 世代上限、インデックス整合性、ゴースト検出 |
| ErrorChannel | AutoSaveError の分類とリトライ方針 | retryable フラグ検証、指数バックオフの再スケジュール |

## 3. テストディレクトリ構造
```
tests/
  autosave/
    __fixtures__/
      storyboard-sample.json  # 入力データ
      index-ghost.json        # ゴースト検知ケース
    fake-opfs.ts              # InMemory OPFS 実装
    fake-timer.ts             # node:timers/promises を差し替える Fake Timer
    autosave.scheduler.test.ts
    autosave.persistence.test.ts
    autosave.history.test.ts
    autosave.errors.test.ts
    autosave.integration.test.ts
```

## 4. モック API 仕様
```mermaid
classDiagram
  class InMemoryOpfs {
    +writeFile(path: string, data: Uint8Array | string): Promise<void>
    +readFile(path: string): Promise<Uint8Array>
    +rename(from: string, to: string): Promise<void>
    +delete(path: string): Promise<void>
    +stat(path: string): Promise<{ size: number }>
    +list(dir: string): Promise<string[]>
    +reset(): void
  }
  class FakeTimer {
    +install(): void
    +advanceBy(ms: number): Promise<void>
    +runAll(): Promise<void>
    +restore(): void
  }
  InMemoryOpfs --> "uses" AutoSave (sut)
  FakeTimer --> AutoSaveScheduler
```

### 4.1 I/O コントラクト
| API | 入力 | 出力 | 備考 |
| --- | --- | --- | --- |
| `writeFile` | `path`, `data` | `void` | `.tmp` → rename を許容する。履歴用に `history/` 下へ直書き。 |
| `readFile` | `path` | `Uint8Array` | UTF-8 JSON を期待。存在しない場合は `NotFoundError` を投げる。 |
| `rename` | `from`, `to` | `void` | 原子的更新を模擬し、ターゲット既存時は置き換え。 |
| `delete` | `path` | `void` | 子要素があるディレクトリは拒否。 |
| `stat` | `path` | `{ size }` | 直近書込サイズを返却。 |
| `list` | `dir` | `string[]` | 辞書順に返却し、履歴のソートを deterministic に。 |
| `advanceBy` | `ms` | `void` | タスクキューを進め、保留中の Promise を解決。 |
| `runAll` | - | `void` | 残存タスクをすべて実行。 |

## 5. Fake Timer 適用方針
1. 各テストケースの `beforeEach` で `FakeTimer.install()` を呼び、`globalThis.setTimeout` と `setInterval` を差し替える。
2. デバウンス検証は `advanceBy(499)` で未保存、`advanceBy(1)` で保存キュー登録を確認。
3. アイドル待機は `advanceBy(debounce + idle)` の二段階で検証。
4. 指数バックオフは `advanceBy(2000)` → 再スケジュール → `advanceBy(4000)` を確認し、`retryCount` が正しく増加するかを観測。
5. `afterEach` で `FakeTimer.restore()` を行い、副作用を回収。

## 6. TDD シナリオ表
| スプリント | シナリオ | Red | Green | Refactor |
| --- | --- | --- | --- | --- |
| 1 | デバウンス保存 | `autosave.scheduler.test.ts` でダブル入力時の保存抑制失敗を観測 | スケジューラ実装 | メソッド抽出で可読性向上 |
| 1 | アイドル判定 | `advanceBy(2500)` でも保存されないバグ | アイドル監視を挿入 | テストヘルパー整備 |
| 2 | 履歴 FIFO | 履歴が 21 件残る失敗を作成 | GC 実装で 20 件に | スタブ共通化 |
| 2 | 容量制限 | 50MB 超過時の削除失敗を注入 | サイズ合計計算で削除 | サイズ計算のキャッシュ導入 |
| 3 | エラーリトライ | `lock-unavailable` で停止するバグ | 再スケジュール実装 | ロガー抽象化 |
| 3 | ゴースト再構築 | `index.json` の孤立項目で復元失敗 | ゴースト検出処理 | メタデータ同期ロジック整理 |
| 4 | 統合フロー | `flushNow` が並列実行を許す | 実装で実行中ジョブ待機 | ステータス計測一元化 |

## 7. テストケース一覧
| カテゴリ | ケース ID | 検証内容 | 入力フィクスチャ | 期待結果 |
| --- | --- | --- | --- | --- |
| デバウンス | DB-001 | 200ms 間隔の 5 連続入力で保存 1 回のみ | `storyboard-sample.json` | `retryCount=0`, `history` 無更新 |
| アイドル | ID-001 | 500ms 後に入力停止 → 2s 待機で保存 | 同上 | `phase` 遷移 `debouncing→awaiting-lock→writing-current` |
| アイドル | ID-002 | `flushNow()` でアイドル待機スキップ | 同上 | `current.json` 即時更新、`history` 未更新 |
| 履歴 | HI-001 | 21 件投入で最古の 1 件削除 | 連番生成 | `history/` が 20 ファイル、`index.json` 整合 |
| 容量 | CP-001 | 60MB 相当データを保存 | 大容量フィクスチャ | 容量超過で古い世代削除、合計 ≤ 50MB |
| エラー | ER-001 | Web Lock 拒否 | 連続 `lock-unavailable` 注入 | `retryable=true` で 3 回再試行 |
| エラー | ER-002 | 書込中断でロールバック | `writeFile` 例外 | `.tmp` ファイルが残らず、`index` 不整合なし |
| 履歴整合 | GH-001 | `index.json` にゴースト | `index-ghost.json` | ゴースト再構築、`retained=false` マーク |
| 統合 | IT-001 | `restorePrompt` が最新を返す | `current` + `history` | `source='current'`, `bytes` 合致 |

## 8. 再現性と分離戦略
- テストごとに `InMemoryOpfs.reset()` を実行し、状態の持ち越しを防止。
- Fake Timer を常に `afterEach` でリセットし、他テストのタイマーに影響させない。
- `process.env` などのグローバル変更はテストごとに元へ戻す。

## 9. CI コマンド
- `pnpm lint` (ESLint/ruff ラッパー) — AutoSave 関連 TypeScript の静的解析。
- `pnpm typecheck` — TypeScript + `mypy --strict` を連鎖実行。
- `pnpm test` — `node:test` + `pytest` をまとめて実行。

## 10. ノート
- Timer 制御で実時間を消費しないため、CI 実行時間の増加は 5% 未満と見積もる。
- Collector/Analyzer のログ I/O と競合しないよう、テスト時は OPFS ルートを `tests/.tmp/opfs` に固定する。
