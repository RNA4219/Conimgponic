# AutoSave フラグ試験計画

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

## 6. CI コマンド順序
1. `pnpm lint` — ruff 相当の静的解析（※Node 環境で ESLint 代替として設定予定）。
2. `pnpm typecheck` — `tsc --noEmit` を想定。
3. `pnpm test --filter autosave` — Node Test Runner で AutoSave 系のユニット/統合を順次実行。
4. `pnpm test -- --coverage` — 回帰時のスナップショット更新前に全体の差分を確認。
